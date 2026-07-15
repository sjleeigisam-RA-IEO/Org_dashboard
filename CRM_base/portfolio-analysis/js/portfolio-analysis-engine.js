(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PortfolioAnalysisEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RULE_VERSION = '2026-07-13.1';
  var UNKNOWN = '미분류';
  var EXPOSURE_FILTER_KEYS = new Set(['domestic_overseas', 'base_asset_class']);
  var INVALID_VALUES = new Set(['', '-', '0', 'null', 'undefined', 'n/a', 'none', 'nan']);

  var FILTER_DEFINITIONS = [
    { key: 'operational_status', label: '운용 상태', group: '집계 기준', options: ['운용', '청산', '설정예정', '미설정'] },
    { key: 'vehicle_type', label: '투자기구', group: '집계 기준', options: ['Fund', 'PFV', 'REITs', 'SPC', '기타', UNKNOWN] },
    { key: 'parent_child_type', label: '모자 구분', group: '집계 기준', options: ['일반펀드', '모펀드', '자펀드', UNKNOWN] },
    { key: 'property_domain', label: '부동산 구분', group: '핵심 분류', options: ['부동산', '비부동산', UNKNOWN] },
    { key: 'domestic_overseas', label: '국내/해외', group: '핵심 분류', options: ['국내', '해외', UNKNOWN] },
    { key: 'base_asset_class', label: '기초자산', group: '핵심 분류', options: ['오피스', '물류센터', '리테일', '호텔', '주거', '데이터센터', '인프라', '금융상품', '기업주식', '특별자산', 'NPL', '기타', UNKNOWN] },
    { key: 'investment_mode', label: '직접/재간접', group: '핵심 분류', options: ['직접', '재간접', UNKNOWN] },
    { key: 'business_stage', label: '개발/운영', group: '핵심 분류', options: ['개발', '운영·실물', '기타', UNKNOWN] },
    { key: 'physical_link', label: '실물자산 연결', group: '핵심 분류', options: ['연결', '미연결'] },
    { key: 'division', label: '부문', group: '조직/형태', dynamic: true },
    { key: 'legal_form', label: '법적 형태', group: '조직/형태', dynamic: true },
    { key: 'fund_type', label: '펀드 유형', group: '조직/형태', dynamic: true }
  ];

  var ASSET_CLASS_RULES = [
    { label: '데이터센터', pattern: /데이터\s*센터|데이타\s*센터|data\s*cent(?:er|re)|\bidc\b/i },
    { label: '물류센터', pattern: /물류|로지스틱|logistics|warehouse|fulfillment/i },
    { label: '오피스', pattern: /오피스|office/i },
    { label: '리테일', pattern: /리테일|상업시설|판매시설|백화점|마트|retail/i },
    { label: '호텔', pattern: /호텔|리조트|관광숙박|hotel|resort/i },
    { label: '주거', pattern: /주거|공동주택|임대주택|기숙사|생활숙박|residential|housing/i },
    { label: '인프라', pattern: /인프라|도로|철도|에너지|태양광|풍력|infrastructure/i },
    { label: '금융상품', pattern: /금융상품|예금|채권|수익증권|credit|bond/i },
    { label: '기업주식', pattern: /기업주식|비상장주식|상장주식|corporate\s*equity/i },
    { label: '특별자산', pattern: /특별자산|special\s*asset/i },
    { label: 'NPL', pattern: /\bnpl\b|부실채권/i }
  ];

  function clean(value) {
    if (value === undefined || value === null) return '';
    var text = String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return INVALID_VALUES.has(text.toLowerCase()) ? '' : text;
  }

  function unique(values) {
    return Array.from(new Set((values || []).filter(Boolean)));
  }

  function safeMetadata(row) {
    return row && row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  }

  function firstValue(values) {
    for (var i = 0; i < values.length; i += 1) {
      var value = clean(values[i]);
      if (value) return value;
    }
    return '';
  }

  function hasAny(text, pattern) {
    return pattern.test(clean(text));
  }

  function normalizeStatus(value) {
    var text = clean(value);
    if (!text) return UNKNOWN;
    if (/청산|종료|해지/.test(text)) return '청산';
    if (/설정\s*예정|예정/.test(text)) return '설정예정';
    if (/운용|활성|active/i.test(text)) return '운용';
    if (/미설정|미정/.test(text)) return '미설정';
    return text;
  }

  function normalizeVehicle(value) {
    var text = clean(value);
    if (!text) return UNKNOWN;
    if (/^fund$/i.test(text) || /펀드/.test(text)) return 'Fund';
    if (/pfv/i.test(text)) return 'PFV';
    if (/reit/i.test(text)) return 'REITs';
    if (/spc/i.test(text)) return 'SPC';
    if (/기타/.test(text)) return '기타';
    return text;
  }

  function normalizeHolding(value) {
    var text = clean(value);
    if (!text) return UNKNOWN;
    if (/자펀드|child/i.test(text)) return '자펀드';
    if (/모펀드|parent/i.test(text)) return '모펀드';
    if (/일반/.test(text)) return '일반펀드';
    return text;
  }

  function normalizePropertyDomain(fund, vehicle) {
    var text = clean(fund.fund_class || fund.notion_fund_class || safeMetadata(fund).fund_class);
    if (/부동산/.test(text)) return '부동산';
    if (text) return '비부동산';
    if (vehicle === 'PFV' || vehicle === 'REITs') return '부동산';
    return UNKNOWN;
  }

  function normalizeLocation(values) {
    var text = (values || []).map(clean).filter(Boolean).join(' ');
    if (!text) return UNKNOWN;
    if (/^kr$|대한민국|국내|서울|경기|인천|부산|대구|대전|광주|울산|세종|제주|강원|충북|충남|전북|전남|경북|경남/i.test(text)) return '국내';
    if (/해외|글로벌|북미|유럽|아시아|미국|영국|일본|베트남|프랑스|이탈리아|스페인|호주|네덜란드|싱가포르|독일|캐나다|china|usa|uk|global|overseas/i.test(text)) return '해외';
    return UNKNOWN;
  }

  function normalizeAssetClasses(values) {
    var text = (values || []).map(clean).filter(Boolean).join(' ');
    if (!text) return [UNKNOWN];
    var matched = ASSET_CLASS_RULES.filter(function (rule) { return rule.pattern.test(text); }).map(function (rule) { return rule.label; });
    if (matched.length) return unique(matched);
    if (/기타/.test(text)) return ['기타'];
    return [UNKNOWN];
  }

  function normalizeAddress(value) {
    var text = clean(value).toLowerCase();
    if (!text) return '';
    text = text.split(',')[0].trim();
    [' 외 ', ' 및 '].forEach(function (marker) {
      if (text.indexOf(marker) >= 0) text = text.split(marker)[0].trim();
    });
    return text;
  }

  function isSpecificAddress(value) {
    var text = normalizeAddress(value);
    if (!text) return false;
    var broad = new Set(['대한민국', '북미', '유럽', '글로벌', '아시아', '미국', '영국', '네덜란드', '일본', '호주', '프랑스', '이탈리아', '스페인']);
    if (broad.has(text)) return false;
    return text.length >= 8 && (/\d/.test(text) || text.split(' ').length >= 3);
  }

  function isPseudoAsset(asset, fund) {
    var meta = safeMetadata(asset);
    var fundMeta = safeMetadata(fund);
    var text = [
      asset.asset_name, asset.canonical_name, asset.asset_type, asset.address, asset.address_text,
      asset.asset_kind, asset.non_physical_asset_label, meta.asset_name, meta.asset_type,
      meta.investment_sector, meta.fund_type, meta.investment_strategy,
      meta.base_asset_class, meta.asset_nature_class, meta.directness,
      fund.notion_investment_strategy_class, fund.fund_type,
      fund.notion_base_asset_class, fund.notion_asset_nature_class,
      fundMeta.investment_strategy, fundMeta.base_asset_class
    ].map(clean).filter(Boolean).join(' ').toLowerCase();
    return /재간접|펀드오브펀드|fund of fund|\bfof\b|지분증권|포트폴리오|portfolio|fund_interest|synthetic_bucket/.test(text);
  }

  function hasPhysicalEvidence(asset, fund, classes) {
    if (isPseudoAsset(asset, fund)) return false;
    var meta = safeMetadata(asset);
    var pnu = clean(asset.pnu || meta.pnu);
    var address = firstValue([asset.address_text, asset.address, meta.address]);
    return Boolean(pnu || isSpecificAddress(address));
  }

  function physicalAssetKey(asset, fund, classes) {
    if (!hasPhysicalEvidence(asset, fund, classes)) return null;
    var meta = safeMetadata(asset);
    var pnu = clean(asset.pnu || meta.pnu);
    if (pnu) return 'pnu:' + pnu;
    var address = firstValue([asset.address_text, asset.address, meta.address]);
    if (isSpecificAddress(address)) return 'addr:' + normalizeAddress(address);
    return null;
  }

  function normalizeInvestmentMode(fund, exposures) {
    var fundMeta = safeMetadata(fund);
    var indirectText = [
      fund.notion_investment_strategy_class, fund.notion_holding_type_class,
      fund.fund_type, fund.notion_asset_nature_class, fundMeta.investment_strategy,
      fundMeta.holding_type_class, fundMeta.asset_nature_class
    ].map(clean).join(' ');
    var exposureText = (exposures || []).map(function (exposure) {
      var meta = safeMetadata(exposure.raw);
      return [exposure.raw.directness, exposure.raw.exposure_role, meta.directness, meta.exposure_role, exposure.raw.asset_kind].map(clean).join(' ');
    }).join(' ');
    var text = indirectText + ' ' + exposureText;
    if (/재간접|펀드오브펀드|fund of fund|\bfof\b|look_through|fund_interest|synthetic|reference/i.test(text)) return '재간접';
    var directEvidence = (exposures || []).some(function (exposure) { return Boolean(exposure.physicalKey); });
    if (!directEvidence) {
      directEvidence = /실물|개발|대출|loan|core|value.?add|opportunistic/i.test(indirectText);
    }
    return directEvidence ? '직접' : UNKNOWN;
  }

  function normalizeBusinessStage(fund, vehicle, exposures) {
    var explicit = clean(fund.notion_business_stage_class || safeMetadata(fund).business_stage_class);
    var developmentFlag = clean(fund.is_development).toUpperCase();
    var assetStages = (exposures || []).map(function (exposure) { return exposure.assetStage; }).filter(Boolean).join(' ');
    if (developmentFlag === 'Y' || vehicle === 'PFV' || /개발/.test(explicit + ' ' + assetStages)) return '개발';
    if (/운영|실물/.test(explicit + ' ' + assetStages)) return '운영·실물';
    if (developmentFlag === 'N' && (exposures || []).some(function (exposure) { return Boolean(exposure.physicalKey); })) return '운영·실물';
    if (explicit) return '기타';
    return UNKNOWN;
  }

  function normalizeExposure(asset, fund) {
    var meta = safeMetadata(asset);
    var fundMeta = safeMetadata(fund);
    var classes = normalizeAssetClasses([
      asset.asset_type, meta.asset_type, meta.base_asset_class, meta.investment_sector
    ]);
    if (classes.length === 1 && classes[0] === UNKNOWN) {
      classes = normalizeAssetClasses([fund.notion_base_asset_class, fund.asset_name, fundMeta.base_asset_class]);
    }
    var location = normalizeLocation([
      asset.portfolio_region, asset.country_code, asset.location_category,
      meta.asset_location_type, meta.investment_country, meta.fund_location,
      fund.location, fund.primary_region
    ]);
    var stageText = firstValue([asset.business_stage, meta.business_stage, meta.stage, meta.business_stage_class]);
    var assetStage = /개발/.test(stageText) ? '개발' : (/운영|실물/.test(stageText) ? '운영·실물' : '');
    return {
      raw: asset,
      fundId: clean(asset.fund_id || fund.fund_id),
      location: location,
      assetClasses: classes,
      assetStage: assetStage,
      physicalKey: physicalAssetKey(asset, fund, classes),
      synthetic: false
    };
  }

  function syntheticExposure(fund) {
    return {
      raw: {},
      fundId: clean(fund.fund_id),
      location: normalizeLocation([fund.location, fund.primary_region]),
      assetClasses: normalizeAssetClasses([fund.notion_base_asset_class, fund.asset_name, safeMetadata(fund).base_asset_class]),
      assetStage: '',
      physicalKey: null,
      synthetic: true
    };
  }

  function normalizeFund(fund, linkedAssets) {
    var vehicle = normalizeVehicle(fund.notion_vehicle_class || safeMetadata(fund).vehicle_class);
    var exposures = (linkedAssets || []).map(function (asset) { return normalizeExposure(asset, fund); });
    if (!exposures.length) exposures.push(syntheticExposure(fund));
    var investmentMode = normalizeInvestmentMode(fund, exposures);
    var businessStage = normalizeBusinessStage(fund, vehicle, exposures);
    var isDevelopmentScope = clean(fund.is_development).toUpperCase() === 'Y' || vehicle === 'PFV';
    var physicalKeys = unique(exposures.map(function (exposure) { return exposure.physicalKey; }));
    var values = {
      operational_status: normalizeStatus(fund.status || safeMetadata(fund).status),
      aum_status: normalizeStatus(fund.aum_status || fund.status),
      vehicle_type: vehicle,
      parent_child_type: normalizeHolding(fund.notion_holding_type_class || safeMetadata(fund).holding_type_class),
      property_domain: normalizePropertyDomain(fund, vehicle),
      investment_mode: investmentMode,
      business_stage: businessStage,
      development_scope: isDevelopmentScope ? '개발' : '비개발',
      physical_link: physicalKeys.length ? '연결' : '미연결',
      division: firstValue([fund.division, safeMetadata(fund).division]) || UNKNOWN,
      legal_form: firstValue([fund.legal_form, safeMetadata(fund).legal_form]) || UNKNOWN,
      fund_type: firstValue([fund.fund_type, safeMetadata(fund).fund_type]) || UNKNOWN
    };
    return {
      fundId: clean(fund.fund_id),
      raw: fund,
      values: values,
      exposures: exposures,
      physicalKeys: physicalKeys,
      isDevelopmentScope: isDevelopmentScope,
      ruleVersion: RULE_VERSION
    };
  }

  function createDataset(funds, assets) {
    var grouped = new Map();
    (assets || []).forEach(function (asset) {
      var fundId = clean(asset.fund_id);
      if (!fundId) return;
      if (!grouped.has(fundId)) grouped.set(fundId, []);
      grouped.get(fundId).push(asset);
    });
    var fundFacts = (funds || []).map(function (fund) {
      return normalizeFund(fund, grouped.get(clean(fund.fund_id)) || []);
    });
    return {
      ruleVersion: RULE_VERSION,
      createdAt: new Date().toISOString(),
      fundFacts: fundFacts,
      fundById: new Map(fundFacts.map(function (fact) { return [fact.fundId, fact]; }))
    };
  }

  function selectedValues(filters, key, ignoreKeys) {
    if (ignoreKeys && ignoreKeys.has(key)) return [];
    var raw = filters && filters[key];
    if (!Array.isArray(raw)) raw = raw ? [raw] : [];
    return unique(raw.map(clean));
  }

  function includesSelected(actual, selected) {
    if (!selected.length) return true;
    var values = Array.isArray(actual) ? actual : [actual];
    values = values.map(clean);
    return selected.some(function (choice) { return values.indexOf(choice) >= 0; });
  }

  function matchesExposure(exposure, filters, ignoreKeys) {
    var locationSelected = selectedValues(filters, 'domestic_overseas', ignoreKeys);
    var classSelected = selectedValues(filters, 'base_asset_class', ignoreKeys);
    return includesSelected(exposure.location, locationSelected)
      && includesSelected(exposure.assetClasses, classSelected);
  }

  function matchesFact(fact, filters, ignoreKeys) {
    var keys = Object.keys(filters || {}).filter(function (key) {
      return !EXPOSURE_FILTER_KEYS.has(key) && !(ignoreKeys && ignoreKeys.has(key));
    });
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var selected = selectedValues(filters, key, ignoreKeys);
      if (selected.length && !includesSelected(fact.values[key], selected)) return false;
    }
    var hasExposureFilters = selectedValues(filters, 'domestic_overseas', ignoreKeys).length
      || selectedValues(filters, 'base_asset_class', ignoreKeys).length;
    return !hasExposureFilters || fact.exposures.some(function (exposure) {
      return matchesExposure(exposure, filters, ignoreKeys);
    });
  }

  function matchesCountBasis(fact, countBasis) {
    if (countBasis === 'representative') return fact.values.parent_child_type !== '자펀드';
    if (countBasis === 'aum_target') {
      return fact.values.aum_status === '운용' && fact.values.parent_child_type !== '자펀드';
    }
    return true;
  }

  function distributionFromFacts(facts, getter) {
    var map = new Map();
    facts.forEach(function (fact) {
      unique(getter(fact)).forEach(function (value) {
        var label = clean(value) || UNKNOWN;
        if (!map.has(label)) map.set(label, new Set());
        map.get(label).add(fact.fundId);
      });
    });
    return Array.from(map.entries()).map(function (entry) {
      return { label: entry[0], count: entry[1].size, ratio: facts.length ? (entry[1].size / facts.length) * 100 : 0 };
    }).sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label, 'ko'); });
  }

  function numericAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    var normalized = clean(value).replace(/,/g, '');
    var parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function exposureName(exposure, fact) {
    var raw = exposure.raw || {};
    var meta = safeMetadata(raw);
    var name = firstValue([
      raw.canonical_name,
      raw.physical_asset_name,
      raw.non_physical_asset_label,
      raw.asset_name,
      meta.asset_name,
      raw.address_text,
      raw.address,
      meta.address
    ]);
    if (name) return name;
    var fund = fact.raw || {};
    return firstValue([
      fund.project_mission_name,
      fund.fund_name,
      fund.short_name,
      fact.fundId
    ]) || '명칭 미상';
  }

  function exposureAllocationKey(exposure, fact) {
    if (exposure.physicalKey) return exposure.physicalKey;
    var raw = exposure.raw || {};
    var id = firstValue([raw.asset_id, raw.id]);
    if (id) return 'asset:' + id;
    if (exposure.synthetic) return 'fund:' + fact.fundId;
    var name = exposureName(exposure, fact).toLowerCase();
    return 'label:' + [name, exposure.location, (exposure.assetClasses || []).join('|')].join('|');
  }

  function amountDistribution(map, total) {
    return Array.from(map.entries()).map(function (entry) {
      return {
        label: entry[0],
        amount: entry[1],
        ratio: total ? (entry[1] / total) * 100 : 0
      };
    }).sort(function (a, b) { return b.amount - a.amount || a.label.localeCompare(b.label, 'ko'); });
  }

  // Allocate each fund's AUM across its distinct matched investment targets. This
  // keeps the portfolio total intact while avoiding full-AUM duplication on
  // funds linked to more than one asset.
  function buildAumComposition(queryResult, options) {
    var safeOptions = options || {};
    var amountField = safeOptions.amountField || 'benchmark_aum';
    var amountGetter = typeof safeOptions.amountGetter === 'function'
      ? safeOptions.amountGetter
      : function (fund) {
        return numericAmount(fund && (fund[amountField] !== undefined ? fund[amountField] : safeMetadata(fund)[amountField]));
      };
    var facts = queryResult && queryResult.facts ? queryResult.facts : [];
    var exposuresByFund = new Map();
    (queryResult && queryResult.exposures ? queryResult.exposures : []).forEach(function (exposure) {
      if (!exposuresByFund.has(exposure.fundId)) exposuresByFund.set(exposure.fundId, []);
      exposuresByFund.get(exposure.fundId).push(exposure);
    });

    var assets = new Map();
    var locationAmounts = new Map();
    var classAmounts = new Map();
    var sourceTotal = 0;
    var allocatedTotal = 0;
    var includedFundCount = 0;
    var fundsWithoutAum = 0;

    facts.forEach(function (fact) {
      var amount = Math.max(0, numericAmount(amountGetter(fact.raw, fact)));
      if (!amount) {
        fundsWithoutAum += 1;
        return;
      }

      var distinct = new Map();
      var sourceExposures = exposuresByFund.get(fact.fundId) || fact.exposures || [];
      sourceExposures.forEach(function (exposure) {
        var key = exposureAllocationKey(exposure, fact);
        if (!distinct.has(key)) distinct.set(key, exposure);
      });
      if (!distinct.size) {
        var fallback = syntheticExposure(fact.raw || {});
        distinct.set(exposureAllocationKey(fallback, fact), fallback);
      }

      includedFundCount += 1;
      sourceTotal += amount;
      var perTarget = amount / distinct.size;
      distinct.forEach(function (exposure, key) {
        var location = clean(exposure.location) || UNKNOWN;
        var classes = unique((exposure.assetClasses || []).map(function (value) { return clean(value) || UNKNOWN; }));
        if (!classes.length) classes = [UNKNOWN];
        var row = assets.get(key);
        if (!row) {
          row = {
            key: key,
            name: exposureName(exposure, fact),
            physical: Boolean(exposure.physicalKey),
            synthetic: Boolean(exposure.synthetic),
            amount: 0,
            fundIds: new Set(),
            locations: new Set(),
            assetClasses: new Set()
          };
          assets.set(key, row);
        }
        row.amount += perTarget;
        row.fundIds.add(fact.fundId);
        row.locations.add(location);
        classes.forEach(function (assetClass) { row.assetClasses.add(assetClass); });
        allocatedTotal += perTarget;

        locationAmounts.set(location, (locationAmounts.get(location) || 0) + perTarget);
        var perClass = perTarget / classes.length;
        classes.forEach(function (assetClass) {
          classAmounts.set(assetClass, (classAmounts.get(assetClass) || 0) + perClass);
        });
      });
    });

    var cumulative = 0;
    var assetRows = Array.from(assets.values()).sort(function (a, b) {
      return b.amount - a.amount || a.name.localeCompare(b.name, 'ko');
    }).map(function (row, index) {
      cumulative += row.amount;
      return {
        rank: index + 1,
        key: row.key,
        name: row.name,
        physical: row.physical,
        synthetic: row.synthetic,
        amount: row.amount,
        ratio: allocatedTotal ? (row.amount / allocatedTotal) * 100 : 0,
        cumulativeRatio: allocatedTotal ? (cumulative / allocatedTotal) * 100 : 0,
        fundCount: row.fundIds.size,
        locations: Array.from(row.locations),
        assetClasses: Array.from(row.assetClasses)
      };
    });

    return {
      sourceTotal: sourceTotal,
      allocatedTotal: allocatedTotal,
      allocationGap: sourceTotal - allocatedTotal,
      includedFundCount: includedFundCount,
      fundsWithoutAum: fundsWithoutAum,
      assetRows: assetRows,
      distributions: {
        domestic_overseas: amountDistribution(locationAmounts, allocatedTotal),
        base_asset_class: amountDistribution(classAmounts, allocatedTotal)
      }
    };
  }

  function query(dataset, spec) {
    var safeSpec = spec || {};
    var filters = safeSpec.filters || {};
    var ignoreKeys = new Set(safeSpec.ignoreKeys || []);
    var countBasis = safeSpec.countBasis || 'fund_code';
    var facts = (dataset && dataset.fundFacts ? dataset.fundFacts : []).filter(function (fact) {
      return matchesCountBasis(fact, countBasis) && matchesFact(fact, filters, ignoreKeys);
    });

    var matchedExposures = [];
    var uniqueAssets = new Map();
    var linkedFunds = new Set();
    facts.forEach(function (fact) {
      fact.exposures.forEach(function (exposure) {
        if (!matchesExposure(exposure, filters, ignoreKeys)) return;
        matchedExposures.push(exposure);
        if (exposure.physicalKey) {
          linkedFunds.add(fact.fundId);
          if (!uniqueAssets.has(exposure.physicalKey)) uniqueAssets.set(exposure.physicalKey, exposure);
        }
      });
    });

    var fundOnly = facts.filter(function (fact) { return fact.values.vehicle_type === 'Fund'; });
    var propertyCount = fundOnly.filter(function (fact) { return fact.values.property_domain === '부동산'; }).length;
    var nonPropertyCount = fundOnly.filter(function (fact) { return fact.values.property_domain === '비부동산'; }).length;
    var propertyUnknownCount = fundOnly.length - propertyCount - nonPropertyCount;
    var developmentBase = facts.filter(function (fact) {
      return fact.values.vehicle_type === 'Fund' || fact.values.vehicle_type === 'PFV';
    });
    var developmentCount = developmentBase.filter(function (fact) { return fact.isDevelopmentScope; }).length;

    var distributions = {
      operational_status: distributionFromFacts(facts, function (fact) { return [fact.values.operational_status]; }),
      vehicle_type: distributionFromFacts(facts, function (fact) { return [fact.values.vehicle_type]; }),
      property_domain: distributionFromFacts(fundOnly, function (fact) { return [fact.values.property_domain]; }),
      domestic_overseas: distributionFromFacts(facts, function (fact) { return fact.exposures.map(function (exposure) { return exposure.location; }); }),
      base_asset_class: distributionFromFacts(facts, function (fact) {
        return fact.exposures.reduce(function (all, exposure) { return all.concat(exposure.assetClasses); }, []);
      }),
      investment_mode: distributionFromFacts(facts, function (fact) { return [fact.values.investment_mode]; }),
      business_stage: distributionFromFacts(facts, function (fact) { return [fact.values.business_stage]; }),
      parent_child_type: distributionFromFacts(facts, function (fact) { return [fact.values.parent_child_type]; })
    };

    return {
      spec: { filters: filters, countBasis: countBasis, ignoreKeys: Array.from(ignoreKeys) },
      facts: facts,
      funds: facts.map(function (fact) { return fact.raw; }),
      exposures: matchedExposures,
      assets: Array.from(uniqueAssets.values()),
      metrics: {
        fundCount: facts.length,
        fundVehicleCount: fundOnly.length,
        uniquePhysicalAssetCount: uniqueAssets.size,
        linkedFundCount: linkedFunds.size,
        propertyCount: propertyCount,
        nonPropertyCount: nonPropertyCount,
        propertyUnknownCount: propertyUnknownCount,
        propertyRatio: fundOnly.length ? (propertyCount / fundOnly.length) * 100 : 0,
        developmentBaseCount: developmentBase.length,
        developmentCount: developmentCount,
        developmentRatio: developmentBase.length ? (developmentCount / developmentBase.length) * 100 : 0
      },
      distributions: distributions,
      ruleVersion: dataset ? dataset.ruleVersion : RULE_VERSION
    };
  }

  function getFilterOptions(dataset, key) {
    var definition = FILTER_DEFINITIONS.find(function (item) { return item.key === key; });
    if (definition && definition.options) return definition.options.slice();
    var values = new Set();
    (dataset && dataset.fundFacts ? dataset.fundFacts : []).forEach(function (fact) {
      var value = fact.values[key];
      (Array.isArray(value) ? value : [value]).forEach(function (item) {
        var normalized = clean(item);
        if (normalized) values.add(normalized);
      });
    });
    return Array.from(values).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }

  function addFilter(filters, key, values) {
    var list = Array.isArray(values) ? values : [values];
    filters[key] = unique((filters[key] || []).concat(list));
  }

  function parseQuestion(input) {
    var text = clean(input);
    if (!text) return null;
    var analytical = /몇\s*(개|건)|개수|갯수|건수|비율|비중|구성|분포|현황|얼마나|수는|수\?|수？|어떻/.test(text);
    if (!analytical) return null;

    var filters = {};
    var denominatorFilters = {};
    var impliedActive = !/청산|설정예정|미설정|전체\s*(기간|상태)|과거/.test(text);
    if (/청산/.test(text)) addFilter(filters, 'operational_status', '청산');
    else if (/설정\s*예정/.test(text)) addFilter(filters, 'operational_status', '설정예정');
    else if (/미설정/.test(text)) addFilter(filters, 'operational_status', '미설정');
    else if (/운용|현재/.test(text) || impliedActive) addFilter(filters, 'operational_status', '운용');

    var includesPfv = /pfv/i.test(text) && /포함|같이|함께/.test(text);
    if (includesPfv) addFilter(filters, 'vehicle_type', ['Fund', 'PFV']);
    else if (/pfv/i.test(text)) addFilter(filters, 'vehicle_type', 'PFV');
    else if (/펀드/.test(text)) addFilter(filters, 'vehicle_type', 'Fund');
    else if (/reit/i.test(text)) addFilter(filters, 'vehicle_type', 'REITs');

    if (/국내/.test(text)) addFilter(filters, 'domestic_overseas', '국내');
    if (/해외|글로벌/.test(text)) addFilter(filters, 'domestic_overseas', '해외');

    ASSET_CLASS_RULES.forEach(function (rule) {
      if (rule.pattern.test(text)) addFilter(filters, 'base_asset_class', rule.label);
    });
    if (/재간접|펀드오브펀드|fund of fund|\bfof\b/i.test(text)) addFilter(filters, 'investment_mode', '재간접');
    else if (/직접/.test(text)) addFilter(filters, 'investment_mode', '직접');

    if (/개발\s*펀드/.test(text)) addFilter(filters, 'development_scope', '개발');
    else if (/개발/.test(text)) addFilter(filters, 'business_stage', '개발');
    else if (/운영\s*중|실물/.test(text)) addFilter(filters, 'business_stage', '운영·실물');

    if (/비부동산/.test(text)) addFilter(filters, 'property_domain', '비부동산');
    else if (/부동산(형)?\s*펀드/.test(text)) addFilter(filters, 'property_domain', '부동산');

    if (/연결.*(부동산|실물).*자산|실물.*자산.*연결/.test(text)) addFilter(filters, 'physical_link', '연결');

    var isRatio = /비율|비중/.test(text);
    var isDistribution = /부동산.*비부동산|비부동산.*부동산/.test(text)
      || /국내.*해외|해외.*국내/.test(text)
      || /구성|분포/.test(text);
    var entity = /자산/.test(text) && !/부동산.*비부동산.*펀드|펀드.*비율/.test(text) ? 'asset' : 'fund';
    var metric = isDistribution ? 'distribution' : (isRatio ? 'ratio' : (entity === 'asset' ? 'asset_count' : 'fund_count'));
    var dimension = null;
    if (/부동산.*비부동산|비부동산.*부동산/.test(text)) dimension = 'property_domain';
    else if (/국내.*해외|해외.*국내/.test(text)) dimension = 'domestic_overseas';
    else if (/직접.*재간접|재간접.*직접/.test(text)) dimension = 'investment_mode';
    else if (/개발.*실물|실물.*개발|개발.*운영|운영.*개발/.test(text)) dimension = 'business_stage';

    Object.keys(filters).forEach(function (key) {
      if (['operational_status', 'vehicle_type'].indexOf(key) >= 0) denominatorFilters[key] = filters[key].slice();
    });
    if (/국내\s*(펀드|자산)?\s*중/.test(text)) denominatorFilters.domestic_overseas = ['국내'];
    if (/해외\s*(펀드|자산)?\s*중/.test(text)) denominatorFilters.domestic_overseas = ['해외'];
    if (includesPfv) denominatorFilters.vehicle_type = ['Fund', 'PFV'];

    return {
      rawText: text,
      metric: metric,
      entity: entity,
      dimension: dimension,
      filters: filters,
      denominatorFilters: denominatorFilters,
      countBasis: 'fund_code',
      impliedActive: impliedActive
    };
  }

  function answerQuestion(dataset, intent) {
    if (!intent) return null;
    var numerator = query(dataset, { filters: intent.filters, countBasis: intent.countBasis });
    var denominator = query(dataset, { filters: intent.denominatorFilters, countBasis: intent.countBasis });
    var numeratorValue = intent.entity === 'asset' ? numerator.metrics.uniquePhysicalAssetCount : numerator.metrics.fundCount;
    var denominatorValue = intent.entity === 'asset' ? denominator.metrics.uniquePhysicalAssetCount : denominator.metrics.fundCount;
    var value = numeratorValue;
    var unit = intent.entity === 'asset' ? '개' : '개';
    var breakdown = [];

    if (intent.metric === 'ratio') {
      value = denominatorValue ? (numeratorValue / denominatorValue) * 100 : 0;
      unit = '%';
    } else if (intent.metric === 'distribution') {
      var dimension = intent.dimension || 'base_asset_class';
      breakdown = denominator.distributions[dimension] || [];
      value = denominatorValue;
      unit = intent.entity === 'asset' ? '개' : '개';
    }

    var label = intent.metric === 'ratio'
      ? '조건에 해당하는 비율'
      : (intent.metric === 'distribution' ? '분류 구성' : (intent.entity === 'asset' ? '고유 실물자산 수' : '펀드·투자기구 수'));
    return {
      intent: intent,
      numerator: numeratorValue,
      denominator: denominatorValue,
      value: value,
      unit: unit,
      label: label,
      basis: intent.countBasis,
      queryResult: numerator,
      denominatorResult: denominator,
      matchingFunds: numerator.funds,
      breakdown: breakdown,
      ruleVersion: RULE_VERSION
    };
  }

  return {
    RULE_VERSION: RULE_VERSION,
    UNKNOWN: UNKNOWN,
    FILTER_DEFINITIONS: FILTER_DEFINITIONS,
    clean: clean,
    normalizeLocation: normalizeLocation,
    normalizeAssetClasses: normalizeAssetClasses,
    createDataset: createDataset,
    query: query,
    buildAumComposition: buildAumComposition,
    getFilterOptions: getFilterOptions,
    parseQuestion: parseQuestion,
    answerQuestion: answerQuestion
  };
});
