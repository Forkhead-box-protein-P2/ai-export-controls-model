/* global ATLAS_CONFIG, ExportAtlas */
(() => {
  'use strict';
  const c = structuredClone(ATLAS_CONFIG);
  const $ = id => document.getElementById(id);
  const s = {...c.defaults, response: null, outcome: null, metric: 'capRatio', leadWeight: c.lenses[c.defaults.lens].lead};
  let settings = {...c.scenarios[s.scenario]};
  let paths = {}, heatRuns = new Map();
  const percent = x => (100 * x).toFixed(1) + '%';
  const signed = (x, digits = 2) => Math.abs(x) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : (x > 0 ? '+' : '−') + Math.abs(x).toFixed(digits);
  const components = {usEconomy:'US economic surplus', cnEconomy:'Chinese economic surplus', spillovers:'Third-country spillovers',
    openness:'Open access', lead:'Strategic discretion', war:'Conflict losses', catastrophe:'Catastrophe losses'};
  const policyKnobs = {chips:'Finished chips', hbm:'High-bandwidth memory', tools:'Manufacturing equipment', cloud:'Cloud services', enforcement:'Enforcement'};
  const leadSteps = [-1, 0, 0.5, 1, 2];
  const lockSteps = [0, 0.25, 0.5, 0.75, 1];
  const metrics = {
    capRatio: ['US / China capability', 'Ratio of expected useful AI capability. Equal capability is 1×.', r => r.usCap/r.cnCap, 'ratio'],
    computeRatio: ['US / China usable compute', 'Annual services after power limits and cloud transfers.', r => r.usCompute/r.cnCompute, 'ratio'],
    stockRatio: ['US / China installed hardware', 'Physical accelerator capacity after retirement and new deliveries.', r => r.usStock/r.cnStock, 'ratio'],
    trainingRatio: ['US / China training compute', 'Services adjusted for domestic cluster and network efficiency.', r => r.usTrain/r.cnTrain, 'ratio'],
    adoption: ['Domestic adoption in China', 'Domestic share of new Chinese hardware deployment.', r => r.adoption, 'pct'],
    knowledge: ['Chinese chip know-how', 'Know-how index after R&D, production and operational learning.', r => r.knowledge, 'idx'],
    output: ['Chinese chip production', 'Annual domestic manufacturing output in standardized capacity units.', r => r.output, 'idx'],
    imports: ['Chinese chip imports', 'Annual purchased and diverted foreign hardware in capacity units.', r => r.imports, 'idx'],
    usCompute: ['US usable compute', 'Annual US compute services in standardized units.', r => r.usCompute, 'idx'],
    cnCompute: ['Chinese usable compute', 'Annual Chinese compute services including foreign rentals.', r => r.cnCompute, 'idx'],
    usCap: ['US useful AI capability', 'Capability index after returns to frontier training.', r => r.usCap, 'idx'],
    cnCap: ['Chinese useful AI capability', 'Capability index including training and diffusion.', r => r.cnCap, 'idx'],
    warRisk: ['Great-power conflict', 'Cumulative probability of a first conflict by year-end.', r => r.warRisk, 'pct'],
    catRisk: ['AI catastrophe', 'Cumulative probability of a first AI catastrophe by year-end.', r => r.catRisk, 'pct']
  };
  function choose(id, options, value, action) {
    const el = $(id);
    for (const [key,label] of options) el.add(new Option(label,key));
    el.value = value;
    el.addEventListener('change', () => action(el.value));
  }
  const entries = registry => Object.entries(registry).map(([key,obj]) => [key,obj.label]);
  function compute() {
    paths = Object.fromEntries(Object.keys(c.policies).map(key => [key,ExportAtlas.simulate(c,key,settings)]));
    heatRuns = new Map();
  }
  function valueParts(row, lens=c.lenses[s.lens], lead=s.leadWeight) {
    return Object.fromEntries(Object.keys(components).map(k => [k,row[k]*(k === 'lead' ? lead : lens[k])]));
  }
  const sum = obj => Object.values(obj).reduce((a,b)=>a+b,0);
  const t = () => s.year-c.start;
  const rowOf = (policy, time=t()) => ExportAtlas.snapshot(paths[policy],time);
  const plabel = key => c.policies[key].label;
  function setPolicy(key) {
    s.policy = key;
    s.response = s.outcome = null;
    render();
  }
  function makeNodes(registry, target, cls, click) {
    for (const [key,item] of Object.entries(registry)) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'node '+cls+'-node'; el.id = cls+'-'+key;
      el.innerHTML = '<span>'+item.label+'</span><span class="'+(cls === 'policy' ? 'active-arrow' : 'node-pct')+'"></span>';
      el.title = item.note;
      el.onclick = () => click(key);
      $(target).append(el);
    }
  }
  makeNodes(c.policies,'policies','policy',setPolicy);
  makeNodes(c.responses,'responses','response',key => { s.response = s.response === key ? null : key; s.outcome = null; renderMap(); });
  makeNodes(c.outcomes,'outcomes','outcome',key => { s.outcome = s.outcome === key ? null : key; renderMap(); });
  function updateNode(kind,key,label,active,val) {
    const el = $(kind+'-'+key);
    el.setAttribute('aria-pressed',String(active));
    el.lastElementChild.textContent = val;
    el.setAttribute('aria-label',label+(kind === 'policy' ? '' : ', '+val));
  }
  function probability(response) {
    return paths[s.policy].filter(p=>p.response === response).reduce((n,p)=>n+p.weight,0);
  }
  function renderMap() {
    const row = ExportAtlas.snapshot(paths[s.policy],t(),s.response);
    for (const [key,item] of Object.entries(c.policies)) updateNode('policy',key,item.label,key===s.policy,key===s.policy ? '→' : '');
    for (const [key,item] of Object.entries(c.responses)) updateNode('response',key,item.label,key===s.response,percent(probability(key)));
    for (const [key,item] of Object.entries(c.outcomes)) updateNode('outcome',key,item.label,key===s.outcome,percent(row[key]));
    const channels = [
      ['Domestic adoption',percent(row.adoption),'of new deployments'],
      ['Chip know-how',row.knowledge.toFixed(2),'knowledge index'],
      ['Domestic output',row.output.toFixed(2),'capacity units / year'],
      ['US training lead',(row.usTrain/row.cnTrain).toFixed(2)+'×','US / China training services'],
      ['US capability lead',(row.usCap/row.cnCap).toFixed(2)+'×','US / China useful capability'],
      ['AI transition',percent(1-row.ongoing),'cumulative probability']
    ];
    $('mechanicsScope').textContent=plabel(s.policy)+' through '+s.year+' · '+(s.response ? 'Conditional on '+c.responses[s.response].label : 'Averaged over all responses')+'.';
    $('mechanicsGrid').innerHTML=channels.map(([label,val,unit])=>'<div><span>'+label+'</span><strong>'+val+'</strong><small>'+unit+'</small></div>').join('');
    $('riskChannels').textContent='Annual conflict risk starts at '+percent(c.risk.baselineWar)+'. Provocation adds '+(100*row.provocation).toFixed(2)+' percentage points and deterrence subtracts '+(100*row.deterrence).toFixed(2)+'. After bounding each path, the average annual risk is '+percent(row.warHazard)+'.';
    const selected = s.outcome ? c.outcomes[s.outcome] : s.response ? c.responses[s.response] : c.policies[s.policy];
    const condition = s.response ? ' Given “'+c.responses[s.response].label+'”, the right column and risks show conditional probabilities.' : '';
    const extra = s.outcome ? ' Its probability by '+s.year+' is '+percent(row[s.outcome])+'.' : '';
    $('nodeDetail').innerHTML = '<strong>'+selected.label+'</strong> '+selected.note+extra+condition;
    $('allPaths').hidden = !s.response;
    $('warRisk').textContent = percent(row.warRisk); $('catRisk').textContent = percent(row.catRisk); $('riskYear').textContent = s.year;
    drawWires();
  }
  $('allPaths').onclick = () => {s.response = s.outcome = null; renderMap();};
  function drawWires() {
    const frame = $('network').getBoundingClientRect(), svg = $('wires');
    if (!frame.width || !paths[s.policy]) return;
    const rect = id => {
      const r = $(id).getBoundingClientRect();
      return {left:r.left-frame.left,right:r.right-frame.left,y:r.top-frame.top+r.height/2};
    };
    const wire = (from,to,mass,color,opacity) => {
      const x = from.right, x2 = to.left, mid = (x+x2)/2;
      return '<path class="wire" d="M '+x+' '+from.y+' C '+mid+' '+from.y+' '+mid+' '+to.y+' '+x2+' '+to.y+'" stroke="'+color+'" stroke-width="'+(0.65+mass*14)+'" opacity="'+opacity+'"/>';
    };
    const from = rect('policy-'+s.policy), lines = [];
    for (const key of Object.keys(c.responses)) {
      const to = rect('response-'+key), share = probability(key);
      const muted = s.response && key !== s.response;
      if (from.right < to.left) lines.push(wire(from,to,share,'#c7e899',muted ? 0.11 : 0.75));
      const row = ExportAtlas.snapshot(paths[s.policy],t(),key);
      for (const out of Object.keys(c.outcomes)) {
        const focus = !muted && (!s.outcome || s.outcome === out);
        const mass = row[out] * (s.response && !muted ? 1 : share);
        lines.push(wire(to,rect('outcome-'+out),mass,'#86c6bb',focus ? 0.75 : 0.09));
      }
    }
    svg.innerHTML = lines.join('');
  }
  function makeKnob(id, parent, label, min, max, step, change) {
    const el = document.createElement('label'); el.className='knob';
    el.htmlFor = id;
    el.innerHTML = '<span>'+label+'<output for="'+id+'" id="'+id+'-val"></output></span>';
    const slider = document.createElement('input'); slider.type='range'; slider.id=id;
    slider.min=min;slider.max=max;slider.step=step;
    slider.addEventListener('input',()=>change(Number(slider.value)));
    el.append(slider); $(parent).append(el);
  }
  function knob(id,x,text) { $(id).value = x; $(id+'-val').textContent = text; $(id).setAttribute('aria-valuetext',text); }
  for (const [key,label] of Object.entries(policyKnobs)) makeKnob('p-'+key,'policyKnobs',label,0,1,0.01,x=>{
    c.policies[s.policy][key]=x; compute(); render();
  });
  for (const [key,meta] of Object.entries(c.scenario_controls)) makeKnob('w-'+key,'worldKnobs',meta.label,meta.min,meta.max,meta.step,x=>{
    settings[key]=x; compute(); render();
  });
  makeKnob('leadWeight','leadInput','Strategic-discretion weight',-2,5,0.01,x=>{s.leadWeight=x;renderValues();});
  function renderKnobs() {
    $('policyTuneLabel').textContent = plabel(s.policy)+' · 0 is open and 1 is most restrictive.';
    for (const key of Object.keys(policyKnobs)) knob('p-'+key,c.policies[s.policy][key],percent(c.policies[s.policy][key]));
    for (const [key,meta] of Object.entries(c.scenario_controls)) {
      const x=settings[key];
      knob('w-'+key,x,meta.unit === 'years' ? x+' years' : meta.unit === 'share' ? percent(x) : x.toFixed(2));
    }
    const modified = Object.keys(c.scenario_controls).some(k=>settings[k]!==c.scenarios[s.scenario][k]);
    for (const opt of $('scenario').options) opt.text = c.scenarios[opt.value].label+(opt.value===s.scenario && modified ? ' · edited' : '');
  }

  const formatMetric = (x,type) => type==='pct' ? percent(x) : x.toFixed(2)+(type==='ratio' ? '×' : '');
  function renderChart() {
    const [,note,metric,type] = metrics[s.metric];
    const times = Array.from({length:c.end-c.start+1},(_,n)=>n);
    const selected = times.map(n=>metric(rowOf(s.policy,n))), ref=times.map(n=>metric(rowOf(s.reference,n)));
    const low=[], high=[];
    times.forEach(n=>{
      const v=paths[s.policy].map(p=>metric(p.rows[n])); low.push(Math.min(...v)); high.push(Math.max(...v));
    });
    const container=$('chart'), width=Math.max(270,container.clientWidth), height=width<550?195:245;
    const left=type==='pct'?45:41, right=14, top=14, bottom=26;
    const min = Math.min(...low,...ref,...selected,type==='ratio'?1:Infinity);
    const max = Math.max(...high,...ref,...selected,type==='ratio'?1:0);
    const padding = Math.max((max-min)*0.08,0.012);
    const lo=Math.max(0,min-padding), hi=max+padding;
    const x=n=>left+(width-left-right)*n/(c.end-c.start);
    const y=v=>top+(height-top-bottom)*(hi-v)/(hi-lo);
    const coords = (data,reverse=false) => (reverse ? times.slice().reverse() : times).map(n=>x(n).toFixed(2)+' '+y(data[n]).toFixed(2)).join(' L ');
    let svg='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+metrics[s.metric][0]+' for '+plabel(s.policy)+' and '+plabel(s.reference)+', 2026 through 2050"><g font-family="ui-monospace,monospace" font-size="10" fill="#58685e">';
    for (let n=0;n<=4;n++){
      const tick=lo+(hi-lo)*n/4, tickLabel=type==='pct'?(100*tick).toFixed(0)+'%':tick.toFixed(hi-lo<0.6?2:1);
      svg+='<path d="M'+left+' '+y(tick)+'H'+(width-right)+'" stroke="#dbe1d5"/><text x="'+(left-7)+'" y="'+(y(tick)+3)+'" text-anchor="end">'+tickLabel+'</text>';
    }
    for(const year of [2026,2030,2035,2040,2045,2050]){
      if(width<430 && (year===2030||year===2045))continue;
      svg+='<text x="'+x(year-c.start)+'" y="'+(height-5)+'" text-anchor="middle">'+year+'</text>';
    }
    svg+='</g><path d="M '+coords(high)+' L '+coords(low,true)+' Z" fill="#438e7220"/>';
    if (type==='ratio' && lo<1 && hi>1) svg+='<path d="M'+left+' '+y(1)+'H'+(width-right)+'" stroke="#8c9d91" stroke-dasharray="2 3"/>';
    svg+='<path d="M '+coords(selected)+'" fill="none" stroke="#17685e" stroke-width="3"/><path d="M '+coords(ref)+'" fill="none" stroke="#a45b31" stroke-width="2.25" stroke-dasharray="6 4"/>';
    svg+='<path d="M'+x(t())+' '+top+'V'+(height-bottom)+'" stroke="#667e70" stroke-dasharray="2 4"/><circle cx="'+x(t())+'" cy="'+y(selected[t()])+'" r="4.5" fill="#17685e" stroke="#fff" stroke-width="2"/></svg>';
    container.innerHTML=svg;
    $('legendPolicy').textContent=plabel(s.policy); $('legendRef').textContent=plabel(s.reference);
    $('metricNote').textContent=note+' Shading spans the nine selected-policy paths.';
    $('chartReadout').textContent=s.year+' · '+formatMetric(selected[t()],type)+' vs '+formatMetric(ref[t()],type);
    container.onclick = event => {
      const offset=event.clientX-container.getBoundingClientRect().left;
      s.year=c.start+Math.round((c.end-c.start)*Math.max(0,Math.min(1,(offset-left)/(width-left-right)))); render();
    };
  }
  function renderValues() {
    knob('leadWeight',s.leadWeight,s.leadWeight.toFixed(2));
    for (const opt of $('lens').options) opt.text=c.lenses[opt.value].label+(opt.value===s.lens && s.leadWeight!==c.lenses[s.lens].lead ? ' · edited' : '');
    const ref=rowOf(s.reference), selected=rowOf(s.policy);
    const base=sum(valueParts(ref));
    const scores=Object.keys(c.policies).map(key=>({key,delta:sum(valueParts(rowOf(key)))-base})).sort((a,b)=>b.delta-a.delta);
    $('rankNote').textContent='Value points vs. '+plabel(s.reference)+' through '+s.year+'.';
    const rankEl=$('ranking');
    for (const [idx,{key,delta}] of scores.entries()) {
      let button=$('rank-'+key);
      if (!button) {button=document.createElement('button');button.type='button';button.className='rank-row';button.id='rank-'+key;button.onclick=()=>setPolicy(key);}
      button.innerHTML='<span><span class="rank-id">'+(idx+1)+'</span>'+plabel(key)+'</span><strong>'+signed(delta)+'</strong>';
      button.setAttribute('aria-pressed',String(key===s.policy)); rankEl.append(button);
    }
    const parts=valueParts(selected), refParts=valueParts(ref);
    const diffs=Object.fromEntries(Object.keys(parts).map(k=>[k,parts[k]-refParts[k]]));
    const max=Math.max(0.001,...Object.values(diffs).map(Math.abs));
    $('deltaNote').textContent=plabel(s.policy)+' minus '+plabel(s.reference)+' · '+signed(sum(diffs))+' points.';
    $('decomposition').innerHTML=Object.entries(diffs).map(([k,d])=>'<div class="component"><span>'+components[k]+'</span><span class="component-bar"><i class="'+(d<0?'neg':'')+'" style="width:'+Math.abs(d)/max*65+'%"></i></span><b>'+signed(d)+'</b></div>').join('');
    const slope=selected.lead-ref.lead, other=sum(diffs)-diffs.lead;
    let msg;
    if (s.policy===s.reference) msg='Choose two different policies to find the weight at which their values cross.';
    else if (Math.abs(slope)<1e-10) msg='Both policies have the same expected strategic-discretion payoff. Its weight cannot change their ranking.';
    else {
      const cross=-other/slope, direction=slope>0?'above':'below';
      msg=plabel(s.policy)+' scores higher than '+plabel(s.reference)+' when the strategic-discretion weight is '+direction+' '+cross.toFixed(2)+'. Your current weight is '+s.leadWeight.toFixed(2)+'.';
    }
    $('breakEven').textContent=msg;
    $('weightsTable').textContent='Current weights · '+Object.entries(components).map(([k,label])=>label+' '+(k==='lead'?s.leadWeight:c.lenses[s.lens][k]).toFixed(2)).join(' · ')+'.';
    renderHeat();
  }
  function renderHeat() {
    const key=[s.policy,s.reference].join('|');
    if(!heatRuns.has(key)) heatRuns.set(key,lockSteps.map(lock=>{
      const opts={...settings,lock};
      return [s.policy,s.reference].map(policy=>ExportAtlas.simulate(c,policy,opts));
    }));
    const rows=heatRuns.get(key).map(pair=>pair.map(branches=>ExportAtlas.snapshot(branches,t())));
    const matrix=rows.map(([a,b])=>leadSteps.map(w=>sum(valueParts(a,c.lenses[s.lens],w))-sum(valueParts(b,c.lenses[s.lens],w))));
    const max=Math.max(0.01,...matrix.flat().map(Math.abs));
    let html='<div class="heat-axis">Exclusive lead at arrival ↓ &nbsp; / &nbsp; Strategic-discretion weight →</div><div class="heat-grid"><span></span>'+leadSteps.map(w=>'<span>'+w+'</span>').join('');
    lockSteps.forEach((lock,i)=>{
      html+='<span>'+Math.round(lock*100)+'%</span>';
      leadSteps.forEach((w,j)=>{
        const delta=matrix[i][j],alpha=(0.1+0.62*Math.abs(delta)/max).toFixed(2);
        const color=delta<0?'189,124,69':'59,147,123',active=lock===settings.lock && w===s.leadWeight;
        html+='<button type="button" class="heat-cell'+(active?' chosen':'')+'" data-i="'+i+'" data-j="'+j+'" aria-pressed="'+active+'" aria-label="Exclusive lead '+percent(lock)+', strategic-discretion weight '+w+', difference '+signed(delta)+' points" style="background:rgba('+color+','+alpha+')">'+signed(delta,1)+'</button>';
      });
    });
    $('heat').innerHTML=html+'</div>';
  }
  $('heat').onclick=event=>{
    const cell=event.target.closest('button'); if(!cell)return;
    const {i,j}=cell.dataset;
    settings.lock=lockSteps[i];s.leadWeight=leadSteps[j];compute();render();
    $('heat').querySelector('[data-i="'+i+'"][data-j="'+j+'"]').focus({preventScroll:true});
  };
  function render(){
    $('year').value=s.year; $('yearValue').textContent=s.year;
    renderMap(); renderKnobs(); renderChart(); renderValues();
  }
  choose('reference',entries(c.policies),s.reference,key=>{s.reference=key;render();});
  choose('scenario',entries(c.scenarios),s.scenario,key=>{s.scenario=key;settings={...c.scenarios[key]}; compute();render();});
  choose('metric',Object.entries(metrics).map(([k,d])=>[k,d[0]]),s.metric,key=>{s.metric=key;renderChart();});
  choose('lens',entries(c.lenses),s.lens,key=>{s.lens=key;s.leadWeight=c.lenses[key].lead;renderValues();});
  $('year').oninput=()=>{s.year=Number($('year').value);render();};
  $('reset').onclick=()=>{
    Object.assign(s,c.defaults,{response:null,outcome:null,metric:'capRatio',leadWeight:c.lenses[c.defaults.lens].lead});
    c.policies=structuredClone(ATLAS_CONFIG.policies); settings={...c.scenarios[s.scenario]};
    for(const key of ['reference','scenario','metric','lens']) $(key).value=s[key];
    compute();render();
  };
  compute(); render();
  new ResizeObserver(drawWires).observe($('network'));
  new ResizeObserver(renderChart).observe($('chart'));
})();
