'use strict';
(function accountHierarchyAdapter() {
  function hierarchyIndex(accounts) {
    const byId = new Map(accounts.map(a => [a.account_id,a]));
    const children = new Map();
    for (const account of accounts) {
      const parent=byId.get(account.parent_account_id);
      if (!parent || parent.account_kind!=='group' || parent===account) continue;
      if (!children.has(parent.account_id)) children.set(parent.account_id,[]);
      children.get(parent.account_id).push(account);
    }
    return {byId,children};
  }
  function visibleAccounts(accounts,hasRm,scope='all',view='account') {
    const {byId,children}=hierarchyIndex(accounts);
    // RM work continues at the original organization where the assignment is held.
    if (view==='rm') return accounts.filter(a=>(a.account_kind!=='group'||hasRm(a))&&(scope!=='rm'||hasRm(a)));
    return accounts.filter(a=>!children.has(a.parent_account_id))
      .filter(a=>scope!=='rm'||hasRm(a)||(children.get(a.account_id)||[]).some(hasRm));
  }
  function sourceAccounts(accounts,hasRm,scope='all') {
    const {byId}=hierarchyIndex(accounts);
    return accounts.filter(a=>a.account_kind!=='group')
      .filter(a=>scope!=='rm'||hasRm(a)||(byId.has(a.parent_account_id)&&hasRm(byId.get(a.parent_account_id))));
  }
  if (typeof module!=='undefined'&&module.exports) {module.exports={hierarchyIndex,visibleAccounts,sourceAccounts};return;}
  if (typeof D==='undefined'||typeof scopedAccounts!=='function'||window.ONE_ACCOUNT_HIERARCHY_INSTALLED) return;
  window.ONE_ACCOUNT_HIERARCHY_INSTALLED=true;
  window.ONE_ACCOUNT_HIERARCHY_SOURCE='('+accountHierarchyAdapter.toString()+')();';
  const ownRm=accountHasRm;
  const members=a=>hierarchyIndex(D.accounts).children.get(a.account_id)||[];
  const element=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  const action=(text,handler,className)=>{const n=element('button',text,className);n.type='button';n.onclick=handler;return n;};
  function prepareGroups() {
    for (const group of D.accounts.filter(a=>a.account_kind==='group')) {
      const rows=members(group);
      group.children_count=rows.length;
      group.crm_hierarchy_member_ids=rows.map(a=>a.account_id);
      const known=new Set(group.aliases.map(a=>a.name));
      for (const child of rows) for (const name of [child.display_name,...child.aliases.map(a=>a.name)]) {
        if (!known.has(name)) {group.aliases.push({name,role:'CRM',source:'account_hierarchy'});known.add(name);}
      }
      group.roles=[...new Set(rows.flatMap(a=>a.roles||[]))];
      group.metrics.role_count=group.roles.length;
      group.capital_conditions={equity:rows.some(a=>a.capital_conditions?.equity),loan:rows.some(a=>a.capital_conditions?.loan)};
      group.piscfh.link_status='ACTIVE_DEFAULT_CANDIDATE';
      group.category='Account 묶음';
    }
  }
  scopedAccounts=function(){return visibleAccounts(D.accounts,ownRm,state.accountScope,state.viewMode);};
  scopedLtRows=function(){if(state.accountScope!=='rm')return LT_ROWS;const ids=new Set(sourceAccounts(D.accounts,ownRm,state.accountScope).map(a=>a.account_id));return LT_ROWS.filter(row=>ids.has(row.account_id));};
  const sourceScope=fn=>function(...args){
    const previous=scopedAccounts;
    scopedAccounts=()=>sourceAccounts(D.accounts,ownRm,state.accountScope);
    try{return fn(...args);}finally{scopedAccounts=previous;}
  };
  if(typeof scopedReviewCandidates==='function')scopedReviewCandidates=sourceScope(scopedReviewCandidates);
  if(typeof scopedQualityValues==='function')scopedQualityValues=sourceScope(scopedQualityValues);
  const oldEnsure=ensureScopeSelection;
  ensureScopeSelection=function(){
    const selected=accountsById.get(state.selected);
    if (selected?.parent_account_id&&scopedAccounts().some(a=>a.account_id===selected.parent_account_id)) return;
    oldEnsure();
  };
  const oldControls=updateScopeControls;
  updateScopeControls=function(){
    oldControls();
    const all=visibleAccounts(D.accounts,ownRm,'all',state.viewMode).length;
    const rm=visibleAccounts(D.accounts,ownRm,'rm',state.viewMode).length;
    document.querySelectorAll('[data-scope-count="all"]').forEach(n=>n.textContent=all.toLocaleString());
    document.querySelectorAll('[data-scope-count="rm"]').forEach(n=>n.textContent=rm.toLocaleString());
  };
  const oldKpis=renderKpis;
  renderKpis=function(){
    prepareGroups();oldKpis();updateScopeControls();
    const cards=document.querySelectorAll('#kpis .kpi');
    if(cards[0]){
      cards[0].querySelector('.label').textContent=state.viewMode==='rm'?'조직별 RM 관리':'Account';
      cards[0].querySelector('.hint').textContent=state.viewMode==='rm'?'배정은 개별 조직에 보존':'상위 묶음 기준 · 하위 조직은 펼쳐서 조회';
    }
    const ids=new Set(sourceAccounts(D.accounts,ownRm,state.accountScope).map(a=>a.account_id));
    if(cards[4])cards[4].querySelector('.value').textContent=D.exposures.filter(e=>ids.has(e.account_id)).length.toLocaleString();
  };
  const oldList=renderList;
  renderList=function(){prepareGroups();oldList();
    document.querySelectorAll('.account-row[data-id]').forEach(node=>{
      const account=accountsById.get(node.dataset.id);
      if(account?.account_kind!=='group')return;
      node.classList.add('oa-hierarchy-root');
      node.querySelector('.faces').textContent='조합·조직 '+members(account).length;
      const meta=node.querySelector('.row-meta');
      if(meta)meta.replaceChildren(element('span','하위 조직을 펼쳐서 조회'));
      if(accountsById.get(state.selected)?.parent_account_id===account.account_id)node.classList.add('selected');
    });
  };
  function hierarchyPanel(group) {
    const panel=element('section',undefined,'oa-hierarchy-panel');
    const heading=element('div',undefined,'oa-hierarchy-heading');
    heading.append(element('span','ACCOUNT · '+(group.piscfh.default_candidate_codes.join(', ')||'미Account'),'oa-hierarchy-eyebrow'),element('h2',group.display_name),element('p',`조합·조직 ${members(group).length}개 · 소속인물 ${group.crm_people_count||0}명`));
    if(window.OneAccountCRM)heading.append(action('조직·인물 전체보기',()=>window.OneAccountCRM.openAccount(group.account_id),'oa-hierarchy-open'));
    const search=element('input');search.type='search';search.placeholder='조합·조직 이름 검색';search.setAttribute('aria-label','하위 조합·조직 검색');
    const list=element('div',undefined,'oa-hierarchy-children');
    const paint=()=>{
      list.replaceChildren();const query=search.value.trim().toLowerCase();
      const sections=new Map();
      for(const child of members(group).filter(a=>[a.display_name,...a.aliases.map(x=>x.name)].join(' ').toLowerCase().includes(query)).sort((a,b)=>a.display_name.localeCompare(b.display_name,'ko'))){
        const label=child.hierarchy_label||'하위 조직';if(!sections.has(label))sections.set(label,[]);sections.get(label).push(child);
      }
      for(const [label,rows] of [...sections].sort((a,b)=>(['중앙회','지역 조합','확인 필요'].indexOf(a[0])-['중앙회','지역 조합','확인 필요'].indexOf(b[0])))){
        const details=element('details');details.open=Boolean(query)||rows.length<5;
        details.append(element('summary',`${label} · ${rows.length}개`));
        for(const child of rows){
          const button=action('',()=>selectAccount(child.account_id),'oa-hierarchy-child');
          button.dataset.childAccountId=child.account_id;
          button.append(element('strong',child.display_name),element('span',`소속인물 ${child.crm_people_count||0}명${ownRm(child)?' · RM 배정':''}`));
          details.append(button);
        }
        list.append(details);
      }
      if(!sections.size)list.append(element('p','검색 결과가 없습니다.'));
    };
    search.oninput=paint;paint();panel.append(heading,search,list);return panel;
  }
  const oldMap=renderMap;
  renderMap=function(account){
    const wrap=document.querySelector('#mapWrap');
    const context=document.querySelector('.map-context-strip');
    if(context){
      if(!context.dataset.hierarchyOriginal)context.dataset.hierarchyOriginal=context.innerHTML;
      context.innerHTML=account.account_kind==='group'?'<span><b>1</b> Account</span><i>→</i><span><b>2</b> 조합·조직</span><i>→</i><span><b>3</b> 부서·직책·인물</span>':context.dataset.hierarchyOriginal;
    }
    wrap.querySelectorAll('.oa-hierarchy-panel,.oa-hierarchy-parent').forEach(n=>n.remove());
    wrap.classList.toggle('oa-hierarchy-active',account.account_kind==='group');
    if(account.account_kind==='group'){
      document.querySelector('#accountMap').replaceChildren();
      document.querySelector('#mobileMapTree').replaceChildren();
      wrap.prepend(hierarchyPanel(account));
      document.querySelector('#mapHint').textContent='하위 조합·조직을 선택하세요.';
      return;
    }
    oldMap(account);
    const parent=accountsById.get(account.parent_account_id);
    if(parent)wrap.prepend(action('‹ '+parent.display_name+' 전체 조합·조직',()=>selectAccount(parent.account_id),'oa-hierarchy-parent'));
  };
  if(!document.querySelector('#oa-hierarchy-style')){
    const style=element('style');style.id='oa-hierarchy-style';style.setAttribute('data-one-account-hierarchy','');
    style.textContent='.oa-hierarchy-active .map-stage,.oa-hierarchy-active #mobileMapTree{display:none!important}.oa-hierarchy-panel{box-sizing:border-box;min-height:480px;padding:24px;background:#f7faff;color:#143451}.oa-hierarchy-heading h2{font-size:27px;margin:5px 0}.oa-hierarchy-heading p{color:#60798e;font-size:12px}.oa-hierarchy-eyebrow{font-size:10px;letter-spacing:1px;color:#50759c}.oa-hierarchy-open{margin:8px 0;padding:8px 12px;background:#163e69;border:0;border-radius:6px;color:white;font-weight:600}.oa-hierarchy-panel input{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid #c3d4e4;border-radius:6px;background:white;margin:10px 0 14px;color:#18374f}.oa-hierarchy-children{max-height:440px;overflow:auto}.oa-hierarchy-children details{margin-bottom:10px;background:white;border:1px solid #d8e3ed;border-radius:7px;padding:10px}.oa-hierarchy-children summary{cursor:pointer;font-size:13px;font-weight:700;padding:4px}.oa-hierarchy-child{display:flex;align-items:center;justify-content:space-between;gap:10px;box-sizing:border-box;width:100%;padding:12px 10px;border:0;border-top:1px solid #e7edf3;background:white;color:#183955;text-align:left;cursor:pointer}.oa-hierarchy-child span{font-size:11px;color:#658097}.oa-hierarchy-child:hover{background:#edf4fc}.oa-hierarchy-parent{display:block;margin:10px 16px;padding:7px 12px;border:1px solid #bbd0e4;background:#fff;border-radius:6px;color:#214b73;cursor:pointer}.oa-hierarchy-root{border-left:4px solid #296daa!important}@media(max-width:760px){.oa-hierarchy-panel{padding:16px;min-height:400px}.oa-hierarchy-child{align-items:flex-start;flex-direction:column;gap:4px}.oa-hierarchy-children{max-height:480px}}';
    document.head.append(style);
  }
  prepareGroups();
  document.querySelector('#viewMode')?.addEventListener('change',()=>{renderKpis();renderSelection();renderLookthrough();renderReviews();renderQuality();});
  if(location.protocol==='file:'||!document.querySelector('#oa-crm-bootstrap')){renderKpis();renderList();renderSelection();}
})();
