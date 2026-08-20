import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type RagChunk = {
  source_table: string
  title: string | null
  content: string
  metadata: Record<string, any> | null
  similarity: number
}

function cleanEnv(value: string | undefined, fallback = '') {
  return (value ?? fallback).replace(/^"|"$/g, '').trim()
}

function extractIntent(query: string) {
  const vehicleMatch = query.match(/\b\d{3}\b/)
  const vehicleFilter = vehicleMatch ? vehicleMatch[0] : null
  const trancheFilter = /(에쿼티|equity|자기자본)/i.test(query) ? 'Equity' : null
  const phaseFilter = /refinancing|리파이낸싱|리파이|재금융/i.test(query) ? 'Refinancing' : null
  const requiresCalculation = /(표|비율|합계|정리|현황)/.test(query)
  const shouldQueryRecentLogs = /(최근|최신).*(협업게시판|협업|게시판|글|업무|로그)|(협업게시판|게시판).*(최근|최신)/i.test(query)
  const shouldQueryCapitalStack =
    !!vehicleFilter &&
    (requiresCalculation ||
      !!trancheFilter ||
      !!phaseFilter ||
      /(투자자|기관|대주|자본|capital|stack|트랜치|tranche|금액)/i.test(query))

  return { vehicleFilter, trancheFilter, phaseFilter, requiresCalculation, shouldQueryCapitalStack, shouldQueryRecentLogs }
}

function getAmount(chunk: RagChunk) {
  const row = chunk.metadata?.source_row ?? {}
  const raw = row.amount_krw_100m ?? chunk.metadata?.amount_krw_100m ?? chunk.metadata?.amount
  const amount = Number(raw)
  return Number.isFinite(amount) ? amount : 0
}

function getTrancheName(chunk: RagChunk) {
  const row = chunk.metadata?.source_row ?? {}
  return row.tranche_name ?? row.tranche_type ?? chunk.metadata?.tranche_name ?? chunk.metadata?.tranche_type ?? 'Unknown'
}

function getInstitutionName(chunk: RagChunk) {
  const row = chunk.metadata?.source_row ?? {}
  return row.institution_name ?? chunk.metadata?.institution_name ?? 'Unknown'
}

function filterChunks(chunks: RagChunk[], vehicleFilter: string | null, trancheFilter: string | null) {
  return chunks.filter((chunk) => {
    const row = chunk.metadata?.source_row ?? {}
    const vehicle = String(row.vehicle_name ?? chunk.metadata?.vehicle_name ?? '')
    const tranche = String(row.tranche_type ?? chunk.metadata?.tranche_type ?? '')

    if (vehicleFilter && vehicle !== vehicleFilter) return false
    if (trancheFilter && tranche !== trancheFilter) return false
    return true
  })
}

async function embedQuery(query: string, apiKey: string) {
  const model = cleanEnv(Deno.env.get('GEMINI_EMBEDDING_MODEL'), 'gemini-embedding-001').replace(/^models\//, '')
  const dimensions = Number(cleanEnv(Deno.env.get('GEMINI_EMBEDDING_DIMENSIONS'), '768'))

  const body: Record<string, any> = {
    content: { parts: [{ text: query }] },
    output_dimensionality: dimensions,
  }

  if (model === 'gemini-embedding-001') {
    body.taskType = 'RETRIEVAL_QUERY'
  }

  const embedRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  const embedData = await embedRes.json()
  const embedding = embedData.embedding?.values

  if (!embedRes.ok || !embedding) {
    console.error('Gemini embedding failed', {
      status: embedRes.status,
      model,
      response: embedData,
    })
    throw new Error(`Embedding failed with model ${model}`)
  }

  return embedding
}

function buildCalculationSummary(chunks: RagChunk[]) {
  const rows = chunks
    .map((chunk) => ({
      tranche: getTrancheName(chunk),
      institution: getInstitutionName(chunk),
      amount: getAmount(chunk),
    }))
    .filter((row) => row.amount > 0)

  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  if (!total) return ''

  const tableRows = rows
    .sort((a, b) => b.amount - a.amount)
    .map((row) => {
      const ratio = ((row.amount / total) * 100).toFixed(1)
      return `| ${row.tranche} | ${row.institution} | ${row.amount.toFixed(2)} | ${ratio}% |`
    })
    .join('\n')

  return `
[Calculated table]
Total amount: ${total.toFixed(2)}억원

| 구분 | 기관 | 금액(억원) | 비율 |
|---|---:|---:|---:|
${tableRows}
| 합계 |  | ${total.toFixed(2)} | 100.0% |
`
}

function chunksFromCapitalRows(rows: Record<string, any>[]) {
  return rows.map((row) => ({
    source_table: 'iota_capital_stack',
    title: `${row.vehicle_name} ${row.phase ?? ''} ${row.tranche_name ?? ''}`.trim(),
    content: [
      `# ${row.vehicle_name} ${row.phase ?? ''} ${row.tranche_name ?? ''}`.trim(),
      '원천 테이블: iota_capital_stack',
      `Vehicle: ${row.vehicle_name ?? ''}`,
      `Phase: ${row.phase ?? ''}`,
      `Tranche: ${row.tranche_type ?? ''} / ${row.tranche_name ?? ''}`,
      `기관: ${row.institution_name ?? ''}`,
      `금액(억원): ${row.amount_krw_100m ?? ''}`,
    ].join('\n'),
    metadata: {
      source_table: 'iota_capital_stack',
      source_row: row,
    },
    similarity: 1,
  }))
}

function chunksFromLogRows(rows: Record<string, any>[]) {
  return rows.map((row) => ({
    source_table: 'iota_seoul_logs',
    title: row.summary ?? row.raw_text ?? row.log_id,
    content: [
      `# ${row.summary ?? row.log_id}`,
      `작성일: ${row.work_date ?? ''}`,
      `작성자: ${row.writer_name ?? ''}`,
      `프로젝트/워크스페이스: ${row.metadata?.project_name ?? ''} / ${row.metadata?.workspace_label ?? ''}`,
      `유형: ${row.metadata?.triage_type ?? ''}`,
      '',
      row.raw_text ?? '',
    ].join('\n'),
    metadata: {
      source_table: 'iota_seoul_logs',
      source_row: row,
    },
    similarity: 1,
  }))
}

async function queryCapitalStack(
  supabaseClient: any,
  vehicleFilter: string,
  trancheFilter: string | null,
  phaseFilter: string | null,
) {
  let query = supabaseClient
    .from('iota_capital_stack')
    .select('vehicle_name,phase,tranche_type,tranche_name,institution_name,amount_krw_100m')
    .eq('vehicle_name', vehicleFilter)
    .order('amount_krw_100m', { ascending: false })

  if (trancheFilter) query = query.eq('tranche_type', trancheFilter)
  if (phaseFilter) query = query.eq('phase', phaseFilter)

  const { data, error } = await query
  if (error) throw error
  return chunksFromCapitalRows(data ?? [])
}

async function queryRecentLogs(supabaseClient: any) {
  const { data, error } = await supabaseClient
    .from('iota_seoul_logs')
    .select('log_id,writer_name,writer_staff_id,work_date,summary,raw_text,metadata,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) throw error
  return chunksFromLogRows(data ?? [])
}

function formatCapitalStackAnswer(chunks: RagChunk[], query: string) {
  const rows = chunks.map((chunk) => chunk.metadata?.source_row ?? {}).filter((row) => row.vehicle_name)
  if (!rows.length) return '해당 조건의 자본구조 데이터가 없습니다.'

  const wantsRatio = /(비율|%|퍼센트)/.test(query)
  const wantsByInstitution = /(투자자|기관|리스트|목록)/.test(query)
  const total = rows.reduce((sum, row) => sum + Number(row.amount_krw_100m || 0), 0)

  if (wantsByInstitution) {
    const byInstitution = new Map<string, { amount: number; phases: Set<string>; tranches: Set<string> }>()
    for (const row of rows) {
      const name = row.institution_name ?? '미상'
      const current = byInstitution.get(name) ?? { amount: 0, phases: new Set<string>(), tranches: new Set<string>() }
      current.amount += Number(row.amount_krw_100m || 0)
      if (row.phase) current.phases.add(row.phase)
      if (row.tranche_name) current.tranches.add(row.tranche_name)
      byInstitution.set(name, current)
    }

    const lines = [...byInstitution.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, item]) => {
        const ratio = total > 0 ? ` | ${((item.amount / total) * 100).toFixed(1)}%` : ''
        return `| ${name} | ${item.amount.toFixed(2)}${ratio} | ${[...item.phases].join(', ')} | ${[...item.tranches].join(', ')} |`
      })
      .join('\n')

    const ratioHeader = wantsRatio ? ' | 비율' : ''
    const ratioSep = wantsRatio ? '|---:' : ''
    return [
      `${rows[0].vehicle_name} 기준 등록 기관 리스트입니다. 중복 기관은 합산했습니다.`,
      '',
      `| 기관 | 금액(억원)${ratioHeader} | Phase | 구분 |`,
      `|---|---:${ratioSep}|---|---|`,
      lines,
      `| 합계 | ${total.toFixed(2)}${wantsRatio ? ' | 100.0%' : ''} |  |  |`,
    ].join('\n')
  }

  const lines = rows
    .sort((a, b) => Number(b.amount_krw_100m || 0) - Number(a.amount_krw_100m || 0))
    .map((row) => {
      const ratio = total > 0 ? ` | ${((Number(row.amount_krw_100m || 0) / total) * 100).toFixed(1)}%` : ''
      return `| ${row.phase ?? ''} | ${row.tranche_name ?? ''} | ${row.institution_name ?? ''} | ${Number(row.amount_krw_100m || 0).toFixed(2)}${wantsRatio ? ratio : ''} |`
    })
    .join('\n')

  const ratioHeader = wantsRatio ? ' | 비율' : ''
  const ratioSep = wantsRatio ? '|---:' : ''
  return [
    `${rows[0].vehicle_name} 자본구조 현황입니다.`,
    '',
    `| Phase | 구분 | 기관 | 금액(억원)${ratioHeader} |`,
    `|---|---|---|---:${ratioSep}|`,
    lines,
    `| 합계 |  |  | ${total.toFixed(2)}${wantsRatio ? ' | 100.0%' : ''} |`,
  ].join('\n')
}

function formatRecentLogsAnswer(chunks: RagChunk[]) {
  const rows = chunks.map((chunk) => chunk.metadata?.source_row ?? {})
  if (!rows.length) return '최근 등록된 업무/게시판 글을 찾지 못했습니다.'

  const lines = rows
    .map((row, index) => {
      const title = row.summary || row.raw_text || '(제목 없음)'
      const type = row.metadata?.triage_type ? ` / ${row.metadata.triage_type}` : ''
      const workspace = row.metadata?.workspace_label ? ` / ${row.metadata.workspace_label}` : ''
      return `${index + 1}. ${row.work_date ?? ''} ${title} - ${row.writer_name ?? ''}${type}${workspace}`
    })
    .join('\n')

  return `최근 등록된 글은 다음과 같습니다.\n\n${lines}`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uniqueModels(models: string[]) {
  return [...new Set(models.map((model) => cleanEnv(model).replace(/^models\//, '')).filter(Boolean))]
}

async function generateAnswer(apiKey: string, promptText: string) {
  const groqApiKey = cleanEnv(Deno.env.get('GROQ_API_KEY'))
  if (groqApiKey) {
    try {
      return await generateAnswerWithGroq(groqApiKey, promptText)
    } catch (err) {
      console.warn('Groq generation failed, falling back to Gemini', err)
    }
  }

  const preferredModel = cleanEnv(Deno.env.get('GEMINI_GENERATION_MODEL'), 'gemini-2.5-flash-lite')
  const models = uniqueModels([
    preferredModel,
    'gemini-flash-lite-latest',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite',
  ])

  let lastError = 'Generation failed'

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const genRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
          }),
        },
      )

      const genData = await genRes.json()
      const answer = genData.candidates?.[0]?.content?.parts?.[0]?.text

      if (genRes.ok && answer) {
        return { answer, model }
      }

      const status = genData.error?.status
      const message = genData.error?.message ?? ''
      lastError = `${model}: ${status || genRes.status} ${message}`
      console.warn('Gemini generation attempt failed', { model, attempt, status: genRes.status, response: genData })

      if (![429, 500, 503].includes(genRes.status)) break
      await sleep(750 * attempt)
    }
  }

  throw new Error(lastError)
}

async function generateAnswerWithGroq(apiKey: string, promptText: string) {
  const preferredModel = cleanEnv(Deno.env.get('GROQ_GENERATION_MODEL'), 'llama-3.1-8b-instant')
  const models = uniqueModels([
    preferredModel,
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
    'openai/gpt-oss-20b',
  ])

  let lastError = 'Groq generation failed'

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: promptText }],
          temperature: 0.2,
          max_completion_tokens: 1200,
        }),
      })

      const data = await res.json()
      const answer = data.choices?.[0]?.message?.content

      if (res.ok && answer) {
        return { answer, model }
      }

      lastError = `${model}: ${data.error?.message ?? res.status}`
      console.warn('Groq generation attempt failed', { model, attempt, status: res.status, response: data })

      if (![429, 500, 503].includes(res.status)) break
      await sleep(750 * attempt)
    }
  }

  throw new Error(lastError)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { query } = await req.json()
    if (!query || typeof query !== 'string') {
      throw new Error('query is required')
    }

    const apiKey = cleanEnv(Deno.env.get('GEMINI_API_KEY'))
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set')
    }

    const {
      vehicleFilter,
      trancheFilter,
      phaseFilter,
      requiresCalculation,
      shouldQueryCapitalStack,
      shouldQueryRecentLogs,
    } = extractIntent(query)

    const supabaseUrl = cleanEnv(Deno.env.get('SUPABASE_URL'))
    const supabaseServiceKey = cleanEnv(
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
        Deno.env.get('SB_SECRET_KEY') ??
        Deno.env.get('SUPABASE_ANON_KEY'),
    )

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set')
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    let chunks: RagChunk[] = []

    if (shouldQueryCapitalStack && vehicleFilter) {
      chunks = await queryCapitalStack(supabaseClient, vehicleFilter, trancheFilter, phaseFilter)
      const answer = formatCapitalStackAnswer(chunks, query)
      const sources = chunks.slice(0, 12).map((chunk) => ({
        source_table: chunk.source_table,
        title: chunk.title,
        similarity: chunk.similarity,
      }))

      return new Response(JSON.stringify({ answer, sources }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } else if (shouldQueryRecentLogs) {
      chunks = await queryRecentLogs(supabaseClient)
      const answer = formatRecentLogsAnswer(chunks)
      const sources = chunks.map((chunk) => ({
        source_table: chunk.source_table,
        title: chunk.title,
        similarity: chunk.similarity,
      }))

      return new Response(JSON.stringify({ answer, sources }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } else {
      const embedding = await embedQuery(query, apiKey)

      const filteredRpc = await supabaseClient.rpc('match_rag_chunks_filtered', {
        query_embedding: embedding,
        match_count: 20,
        vehicle_filter: vehicleFilter,
        tranche_filter: trancheFilter,
        phase_filter: phaseFilter,
      })

      if (!filteredRpc.error) {
        chunks = filteredRpc.data ?? []
      } else {
        console.warn('match_rag_chunks_filtered failed, falling back to match_rag_chunks', filteredRpc.error)
        const fallbackRpc = await supabaseClient.rpc('match_rag_chunks', {
          query_embedding: embedding,
          match_count: 20,
          source_table_filter: null,
        })

        if (fallbackRpc.error) throw fallbackRpc.error
        chunks = filterChunks(fallbackRpc.data ?? [], vehicleFilter, trancheFilter)
      }
    }

    const calcSummary = requiresCalculation ? buildCalculationSummary(chunks) : ''
    const contextStr = chunks.length
      ? chunks
          .slice(0, 12)
          .map((chunk) => `[Source: ${chunk.source_table} | Title: ${chunk.title ?? ''}]\n${chunk.content}`)
          .join('\n\n')
      : '관련된 검색 결과가 없습니다.'

    const systemInstruction = `너는 IOTA 업무 플랫폼의 RAG 기반 업무 도우미다.
반드시 제공된 context와 계산 결과만 근거로 답한다.
근거가 부족하면 "현재 데이터만으로는 확인이 어렵다"고 말한다.
금액, 비율, 합계는 제공된 계산 결과를 우선 사용한다.
프로젝트 번호, vehicle, tranche, phase를 임의로 바꾸지 않는다.
답변은 한국어로 간결하게 작성한다.
사용자가 표를 요청하면 Markdown 표로 작성한다.`

    const promptText = `System Instruction:
${systemInstruction}

Context Documents:
${contextStr}
${calcSummary}

User Question: ${query}`

    const { answer } = await generateAnswer(apiKey, promptText)
    const sources = chunks.slice(0, 12).map((chunk) => ({
      source_table: chunk.source_table,
      title: chunk.title,
      similarity: chunk.similarity,
    }))

    return new Response(JSON.stringify({ answer, sources }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('ai-rag-chat failed', errorMessage)
    return new Response(JSON.stringify({ error: 'AI 응답 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
