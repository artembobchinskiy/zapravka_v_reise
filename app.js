const $=id=>document.getElementById(id);
const pages=['fuel','volume','stations','station','order','result'].map(x=>$(`${x}-page`));
const app=$('app'),tripDate=$('trip-date'),tripRoute=$('trip-route'),tripTruck=$('trip-truck'),limitLeft=$('limit-left'),limitTotal=$('limit-total'),limitFill=$('limit-progress-fill'),errorOverlay=$('error-overlay'),retryBtn=$('retry-btn'),fuelOptions=$('fuel-options'),fuelContinue=$('fuel-continue-btn'),volumeList=$('volume-list'),volumeContinue=$('volume-continue-btn'),selectedFuelsEl=$('selected-fuels'),stationSearch=$('station-search'),stationList=$('station-list'),searchMessage=$('search-message'),stationWarning=$('station-warning'),stationMain=$('station-main-card'),stationLimit=$('station-limit-card'),detailFuels=$('detail-fuels'),stationSummary=$('station-summary'),orderStation=$('order-station-card'),orderFuel=$('order-fuel-card'),orderPumps=$('order-pump-list'),orderSubmit=$('order-submit-btn'),orderBack=$('order-back-btn'),orderChangeVolume=$('order-change-volume-btn'),orderVolumeEditor=$('order-volume-editor'),orderVolumeWheel=$('order-volume-wheel'),fuelingStatus=$('fueling-status'),pumpTitle=$('pump-title'),resultLiters=$('result-liters'),resultAmount=$('result-amount'),resultLimit=$('result-limit'),resultAction=$('result-action-btn');

const SESSION='fuelingUiSession',LOCATION_INTERVAL=60000,DIRECTION_INTERVAL=300000,MIN_MOVE=.5,DIRECTION_MAX_AGE=600000,FUELING_INTERVAL=1500,MAX_VOLUME=2000,ROUTE_DEVIATION=1.4,MIN_ROUTE_MARGIN=50,MAX_BACKWARD_DISTANCE=100;
const FUELS=[['diesel','Дизель'],['diesel_premium','Премиальный дизель'],['diesel_winter','Зимний дизель'],['propane','Пропан'],['ai100','АИ-100'],['ai95','АИ-95'],['ai92','АИ-92']];
const CITIES={'Москва':{lat:55.75,lon:37.62},'Казань':{lat:55.79,lon:49.12}};

let trip=null,stations=[],driverLocation=null,selectedFuels=[],draftFuels=new Set(),planned={},fuelReturn='main',volumeReturn='main',station=null,stationDetails=null,orderFuelId=null,orderLiters=null,selectedPump=null,pendingRequest=null,activeFueling=null,lastResult=null,orderSending=false,statusChecking=false,orderNotice='',retryAction=null,locationTimer=null,fuelingTimer=null,searchVersion=0,cache=new Map(),processed=new Set(),movement=loadMovement(),orderDraftVolume=null;

const money=v=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(v)+' ₽';
const price=v=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)+' ₽/л';
const fuelLabel=id=>FUELS.find(x=>x[0]===id)?.[1]||id;
const roundLiters=v=>Math.max(0,Math.round(Number(v)||0));
const remainingFuelIds=()=>selectedFuels.filter(id=>roundLiters(planned[id])>0);

function hidePages(){pages.forEach(p=>p.classList.remove('visible'))}
function showPage(name){hidePages();$(`${name}-page`).classList.add('visible')}
function showTrip(){tripDate.textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).format(new Date(trip.date+'T00:00:00'));tripRoute.textContent=`${trip.from} → ${trip.to}`;tripTruck.textContent=`Тягач ${trip.truck}`;limitLeft.textContent=money(trip.limitLeft);limitTotal.textContent=money(trip.limitTotal);limitFill.style.width=`${Math.min(100,trip.limitTotal?trip.limitLeft/trip.limitTotal*100:0)}%`}
function save(screen,extra={}){sessionStorage.setItem(SESSION,JSON.stringify({screen,planned,searchQuery:stationSearch.value||'',stationId:station?.station?.id||activeFueling?.stationId||null,orderFuelId,orderLiters,activeFuelingId:activeFueling?.id||extra.activeFuelingId||null,pendingRequest,lastResult,processed:[...processed],...extra}))}
function saved(){try{return JSON.parse(sessionStorage.getItem(SESSION))}catch{return null}}
function clearSaved(){sessionStorage.removeItem(SESSION)}
function showError(action){retryAction=action;errorOverlay.classList.add('visible')}
function hideError(){errorOverlay.classList.remove('visible')}
retryBtn.onclick=async()=>{const action=retryAction;retryAction=null;hideError();if(action)await action()};

function buildWheel(host,value,onChange,min=0,max=MAX_VOLUME){
 host.innerHTML='';
 const wrap=document.createElement('div'),list=document.createElement('div'),focus=document.createElement('div'),unit=document.createElement('div'),values=Array.from({length:max-min+1},(_,i)=>min+i);
 wrap.className='wheel-wrap';list.className='wheel-list';focus.className='wheel-focus';unit.className='wheel-unit';unit.textContent='л';
 list.style.paddingBottom='100px';
 values.forEach(v=>{const item=document.createElement('div');item.className='wheel-item';item.textContent=v||'—';item.dataset.value=v;list.append(item)});
 wrap.append(list,focus,unit);host.append(wrap);
 let current=Math.max(min,Math.min(max,Math.round(Number(value)||min))),currentIndex=values.indexOf(current);
 const paint=i=>[...list.children].forEach((el,n)=>el.classList.toggle('active',n===i));
 function select(){const i=Math.max(0,Math.min(values.length-1,Math.round(list.scrollTop/50))),v=values[i];paint(i);if(v!==current){current=v;onChange(v)}}
 requestAnimationFrame(()=>{list.scrollTop=currentIndex*50;paint(currentIndex)});
 let timer;list.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(select,80)});
}

function fuelKey(){return trip?`fuelSelection_${trip.id}`:null}
function loadFuels(){try{const x=JSON.parse(localStorage.getItem(fuelKey())),valid=FUELS.map(x=>x[0]);return Array.isArray(x)?x.filter(id=>valid.includes(id)):[]}catch{return[]}}
function saveFuels(){localStorage.setItem(fuelKey(),JSON.stringify(selectedFuels))}
function renderFuelOptions(){fuelOptions.innerHTML='';FUELS.forEach(([id,label])=>{const b=document.createElement('button');b.className='fuel-option'+(draftFuels.has(id)?' selected':'');b.textContent=label;if(draftFuels.has(id)){const s=document.createElement('span');s.className='fuel-option-check';s.textContent='✓';b.append(s)}b.onclick=()=>{draftFuels.has(id)?draftFuels.delete(id):draftFuels.add(id);renderFuelOptions()};fuelOptions.append(b)});fuelContinue.disabled=!draftFuels.size}
function openFuel(returnTo){stopLocation();fuelReturn=returnTo;draftFuels=new Set(selectedFuels);showPage('fuel');renderFuelOptions();save('fuel')}
function renderSelectedFuels(){selectedFuelsEl.textContent=selectedFuels.map(fuelLabel).join(', ')}
function validateVolumes(){volumeContinue.disabled=!selectedFuels.length||selectedFuels.some(id=>roundLiters(planned[id])<=0)}
function renderVolumes(){volumeList.innerHTML='';selectedFuels.forEach(id=>{const card=document.createElement('div'),name=document.createElement('div'),wheel=document.createElement('div');card.className='volume-card';name.className='volume-fuel-name';name.textContent=fuelLabel(id);card.append(name,wheel);volumeList.append(card);buildWheel(wheel,roundLiters(planned[id]),v=>{v>0?planned[id]=v:delete planned[id];validateVolumes();save('volume')})});validateVolumes()}
function openVolume(returnTo='main'){volumeReturn=returnTo;showPage('volume');renderVolumes();save('volume')}
async function startFlow(){try{hideError();trip=await FakeApi.getTrip();showTrip();selectedFuels=loadFuels();planned={};selectedFuels.length?openVolume('main'):openFuel('main')}catch(e){if(e.code==='NETWORK_ERROR')showError(startFlow)}}

function emptyMovement(){return{tripId:null,reference:null,direction:null}}
function loadMovement(){try{return{...emptyMovement(),...JSON.parse(localStorage.getItem('driverMovementState'))}}catch{return emptyMovement()}}
function saveMovement(){localStorage.setItem('driverMovementState',JSON.stringify(movement))}
function ensureMovement(){if(!trip||movement.tripId===trip.id)return;movement=emptyMovement();movement.tripId=trip.id;saveMovement()}
function rememberLocation(loc){ensureMovement();const p={lat:loc.lat,lon:loc.lon,timestamp:Date.now()};if(!movement.reference){movement.reference=p;saveMovement();return}if(p.timestamp-movement.reference.timestamp>=DIRECTION_INTERVAL){const d=distance(movement.reference.lat,movement.reference.lon,p.lat,p.lon);movement.direction=d>=MIN_MOVE?{from:movement.reference,to:p,confirmedAt:p.timestamp}:null;movement.reference=p;saveMovement()}}
async function updateLocation(showErr=false){try{driverLocation=await FakeApi.getDriverLocation();rememberLocation(driverLocation);return true}catch(e){if(showErr&&e.code==='NETWORK_ERROR')showError(loadStations);return false}}
async function loadStations(){hideError();if(!await updateLocation(true))return false;try{stations=await FakeApi.getStations();return true}catch(e){if(e.code==='NETWORK_ERROR')showError(loadStations);return false}}
function startLocation(){stopLocation();locationTimer=setInterval(()=>updateLocation(false),LOCATION_INTERVAL)}
function stopLocation(){if(locationTimer)clearInterval(locationTimer);locationTimer=null}

function distance(a,b,c,d){const r=6371,p=x=>x*Math.PI/180,d1=p(c-a),d2=p(d-b),q=Math.sin(d1/2)**2+Math.cos(p(a))*Math.cos(p(c))*Math.sin(d2/2)**2;return r*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q))}
function directionVector(){const d=movement.direction;return d&&Date.now()-d.confirmedAt<=DIRECTION_MAX_AGE?d:null}
function stationDirection(s){const d=directionVector();if(!driverLocation||!d)return'unknown';const scale=Math.cos((driverLocation.lat+s.lat)/2*Math.PI/180),ax=(d.to.lon-d.from.lon)*scale,ay=d.to.lat-d.from.lat,bx=(s.lon-driverLocation.lon)*scale,by=s.lat-driverLocation.lat;return ax*bx+ay*by>=0?'forward':'backward'}
function inTripArea(s){const a=CITIES[trip.from],b=CITIES[trip.to];if(!a||!b)return true;const d=distance(a.lat,a.lon,b.lat,b.lon);return distance(a.lat,a.lon,s.lat,s.lon)+distance(s.lat,s.lon,b.lat,b.lon)<=Math.max(d*ROUTE_DEVIATION,d+MIN_ROUTE_MARGIN)}
async function details(id,force=false){if(!force&&cache.has(id))return cache.get(id);try{const x=await FakeApi.getStation(id);cache.set(id,x);return x}catch(e){if(force)throw e;return null}}
function stationFuelName(d,id){const f=d?.fuels;if(Array.isArray(f)){const x=f.find(v=>typeof v==='string'?v===id:v?.id===id||v?.code===id);if(typeof x==='object'&&x)return x.name||x.title||x.label||fuelLabel(id)}if(f&&typeof f==='object'&&!Array.isArray(f)){const x=f[id];if(typeof x==='string')return x;if(x)return x.name||x.title||x.label||fuelLabel(id)}return fuelLabel(id)}
function fuelState(d,id){const volume=roundLiters(planned[id]),base={id,label:fuelLabel(id),stationLabel:stationFuelName(d,id),volume};if(!Object.hasOwn(d.prices,id))return{...base,status:'missing',available:false,price:null,pumps:[]};const pumps=d.pumps.filter(p=>p.fuels.includes(id)),free=pumps.filter(p=>p.status==='free'),busy=pumps.filter(p=>p.status==='busy');if(!free.length&&!busy.length)return{...base,status:'unavailable',available:false,price:d.prices[id],pumps};return{...base,status:volume<d.litersMin?'below-min':free.length?'ready':'busy',available:true,price:d.prices[id],pumps}}
async function prepare(s){const dist=distance(driverLocation.lat,driverLocation.lon,s.lat,s.lon),dir=stationDirection(s);if(dir==='backward'&&dist>MAX_BACKWARD_DISTANCE)return null;const d=await details(s.id);if(!d)return null;const fs=remainingFuelIds().map(id=>fuelState(d,id));if(!fs.some(x=>x.available))return null;return{station:s,details:d,distance:dist,direction:dir,fuelStates:fs}}
function prelim(q){const words=q.trim().toLowerCase().split(/\s+/).filter(Boolean);return stations.filter(s=>remainingFuelIds().some(id=>Object.hasOwn(s.prices,id))).filter(inTripArea).filter(s=>{const text=(s.brand+' '+s.name+' '+s.address).toLowerCase();return words.every(w=>text.includes(w))})}
function compare(a,b){if(!directionVector())return a.distance-b.distance;const order={forward:0,unknown:1,backward:2};return order[a.direction]-order[b.direction]||a.distance-b.distance}
function dirText(d){return d==='forward'?'В направлении движения':d==='backward'?'В обратном направлении':''}
function listFuelText(f,d){if(f.status==='missing')return[`${f.label} - нет на этой АЗС`,'missing'];if(f.status==='unavailable')return[`${f.stationLabel} - колонки недоступны`,'missing'];if(f.status==='below-min')return[`${f.stationLabel} - мин. объём ${d.litersMin} л`,'warning'];return[`${f.stationLabel} - ${price(f.price)}`,'ready']}
function renderStationCard(x){const b=document.createElement('button');b.className='station-item';const dir=dirText(x.direction);b.innerHTML=`<div class="station-name">${x.station.name}</div><div class="station-info"><span class="station-distance">${x.distance.toFixed(1)} км по прямой</span>${dir?`<span class="station-direction">${dir}</span>`:''}</div>`;x.fuelStates.forEach(f=>{const[t,c]=listFuelText(f,x.details),row=document.createElement('div');row.className=`station-fuel-row ${c}`;row.textContent=t;b.append(row)});const address=document.createElement('div');address.className='station-address';address.textContent=x.station.address;b.append(address);b.onclick=()=>openStation(x);stationList.append(b)}
async function searchStations(){const version=++searchVersion,q=stationSearch.value.trim();save('stations',{searchQuery:q});stationList.innerHTML='';searchMessage.textContent='';if(!q){stationWarning.style.display='none';return}stationWarning.style.display='block';searchMessage.textContent='Проверяем доступность топлива...';const items=(await Promise.all(prelim(q).map(prepare))).filter(Boolean).sort(compare);if(version!==searchVersion)return;stationList.innerHTML='';searchMessage.textContent='';if(!items.length){searchMessage.textContent='Подходящие АЗС не найдены.';return}items.forEach(renderStationCard)}
async function openStations(query=''){cache=new Map();searchVersion++;renderSelectedFuels();stationSearch.value=query;stationList.innerHTML='';searchMessage.textContent='';stationWarning.style.display='none';showPage('stations');if(await loadStations()){startLocation();query?await searchStations():stationSearch.focus();save('stations',{searchQuery:query})}}

function orderPlan(v,min,max){if(v<min)return{possible:false,reason:'below-min',orders:0};const orders=Math.ceil(v/max);return{possible:v>=orders*min,reason:v>=orders*min?'':'cannot-split',orders}}
function orderWord(n){const n100=n%100,n10=n%10;return n100>=11&&n100<=14?'заказов':n10===1?'заказ':n10>=2&&n10<=4?'заказа':'заказов'}
function firstOrder(v,min,max){const p=orderPlan(v,min,max);if(!p.possible)return null;return p.orders===1?v:Math.min(max,v-(p.orders-1)*min)}

function renderStation(){
 const d=stationDetails,s=station.station,dir=dirText(stationDirection(s));
 stationMain.innerHTML=`<div class="station-detail-name">${s.name}</div><div class="station-detail-address">${s.address}</div><div class="station-detail-meta"><span class="station-distance">${station.distance.toFixed(1)} км по прямой</span>${dir?`<span class="station-direction">${dir}</span>`:''}</div>`;
 stationLimit.innerHTML=`<div class="muted">На этой АЗС ограничение по объёму одного заказа:</div><div class="station-limit-value">${d.litersMin}–${d.litersMax} л</div><div class="station-limit-note">Если топлива требуется больше, оформите его несколькими заказами.</div>`;
 const fs=remainingFuelIds().map(id=>fuelState(d,id));detailFuels.innerHTML='';
 fs.forEach(f=>{
  const c=document.createElement('div');c.className='detail-fuel-card'+(!f.available?' unavailable':'');
  const p=f.available?orderPlan(f.volume,d.litersMin,d.litersMax):null;
  c.innerHTML=`<div class="detail-fuel-top"><div class="detail-fuel-name">${f.stationLabel}</div>${f.price!=null?`<div class="detail-fuel-price">${price(f.price)}</div>`:''}</div><div class="detail-fuel-meta"><div class="detail-fuel-volume">Нужно: ${f.volume} л</div>${p?.possible?`<div class="order-count-badge">Потребуется ${p.orders} ${orderWord(p.orders)}</div>`:''}</div>`;
  if(!f.available)c.innerHTML+=`<div class="detail-message warning">${f.status==='missing'?'Этого вида топлива на выбранной АЗС нет.':'Колонки с этим топливом сейчас недоступны.'}</div>`;
  else{
   if(!p.possible)c.innerHTML+=`<div class="detail-message warning">${p.reason==='below-min'?`Объём ниже минимального заказа на этой АЗС - ${d.litersMin} л.`:`Этот объём нельзя распределить по заказам от ${d.litersMin} до ${d.litersMax} л.`}</div>`;
   const b=document.createElement('button');b.className='fuel-order-btn';b.textContent=`Заказать ${f.stationLabel}`;b.disabled=!p.possible;b.onclick=()=>openOrder(f.id);c.append(b);
  }
  detailFuels.append(c);
 });
 const good=fs.filter(f=>f.available&&orderPlan(f.volume,d.litersMin,d.litersMax).possible),sum=good.reduce((a,f)=>a+f.price*f.volume,0);
 stationSummary.innerHTML='<div class="summary-title">Планируемая заправка</div>';
 good.forEach(f=>stationSummary.innerHTML+=`<div class="summary-row"><span>${f.stationLabel} - ${f.volume} л</span><strong>${money(f.price*f.volume)}</strong></div>`);
 if(good.length>1)stationSummary.innerHTML+=`<div class="summary-row summary-total"><span>Итого</span><strong>${money(sum)}</strong></div>`;
 stationSummary.innerHTML+=`<div class="summary-row summary-limit"><span>Доступный лимит рейса</span><strong>${money(trip.limitLeft)}</strong></div>`;
 if(sum>trip.limitLeft)stationSummary.innerHTML+=`<div class="limit-warning">Для указанного объёма топлива текущего остатка лимита рейса недостаточно.</div>`;
}

async function stationContext(id){const[t,l,d]=await Promise.all([FakeApi.getTrip(),FakeApi.getDriverLocation(),FakeApi.getStation(id)]);trip=t;driverLocation=l;stationDetails=d;rememberLocation(l);showTrip();cache.set(id,d);station={station:d,distance:distance(l.lat,l.lon,d.lat,d.lon),direction:stationDirection(d)}}
async function openStation(x){stopLocation();stopFueling();hideError();try{await stationContext(x.station.id);orderFuelId=null;orderLiters=null;selectedPump=null;pendingRequest=null;activeFueling=null;orderNotice='';renderStation();showPage('station');save('station')}catch(e){if(e.code==='NETWORK_ERROR')showError(()=>openStation(x))}}

function currentOrder(){const f=fuelState(stationDetails,orderFuelId),defaultLiters=firstOrder(f.volume,stationDetails.litersMin,stationDetails.litersMax);let liters=orderLiters;if(liters==null||liters<stationDetails.litersMin||liters>stationDetails.litersMax)liters=defaultLiters;return{fuel:f,liters,cost:liters==null?null:liters*f.price}}

function addPlanHint(liters,cost){
 const actualLiters=Number(liters||0),actualCost=Number(cost||0),left=Math.max(0,trip.limitLeft-actualCost);
 const rest=selectedFuels.map(id=>{const vol=Math.max(0,roundLiters(planned[id])-(id===orderFuelId?actualLiters:0));if(!vol)return null;const p=stationDetails.prices[id];return{label:stationFuelName(stationDetails,id),volume:vol,price:Number.isFinite(p)?p:null}}).filter(Boolean);
 if(!rest.length)return;
 const known=rest.filter(x=>x.price!=null),sum=known.reduce((a,x)=>a+x.volume*x.price,0),all=known.length===rest.length,text=rest.map(x=>`${x.label} - ${x.volume} л`).join(', '),n=document.createElement('div');
n.className=all&&sum>left
 ?'order-note problem'
 :'order-note warning';
 n.textContent=all&&sum>left?`После этого заказа останется ${money(left)}. На оставшиеся ${text} по текущим ценам потребуется около ${money(sum)}. Лимита не хватит на ${money(sum-left)}.`:all?`После этого заказа останется ${money(left)}. В плане ещё: ${text}. По текущим ценам средств достаточно.`:`После этого заказа останется ${money(left)}. В плане ещё: ${text}.`;
 orderFuel.append(n);
}

function fuelingText(f){if(f.status==='accepted')return'Заказ принят АЗС. Ожидаем готовность колонки.';if(f.status==='waiting_nozzle')return'Заказ активен. Вставьте пистолет в бак в течение 60 секунд. Ожидайте.';if(f.status==='fueling')return`Идёт заправка: ${f.currentLiters} из ${f.liters} л.`;return''}
function cancelText(f){const reason=f.reason||f.cancelReason;if(reason==='PUMP_TIMEOUT')return'Заправка отменена: пистолет не был вставлен в бак в течение 60 секунд. Удержание возвращено в лимит. Выберите свободную колонку и оформите заказ заново.';if(reason==='STATION_NO_RESPONSE')return'АЗС не подтвердила заказ. Удержание возвращено в лимит. Попробуйте оформить заказ повторно или выберите другую АЗС.';if(reason==='DRIVER_CANCELLED')return'Заказ отменён. Удержание возвращено в лимит. При необходимости оформите новый заказ.';return'Заправка отменена. Удержание возвращено в лимит. Проверьте параметры заказа и попробуйте оформить его повторно.'}

function renderOrder(){
 const pre=currentOrder(),f=pre.fuel,valid=pre.liters!=null,liters=activeFueling?.liters??(valid?pre.liters:f.volume),cost=activeFueling?.amountHeld??(valid?pre.cost:null),p=orderPlan(f.volume,stationDetails.litersMin,stationDetails.litersMax);
 orderStation.innerHTML=`<div class="order-station">${station.station.name}</div><div class="order-address">${station.station.address}</div>`;
 orderFuel.innerHTML=`<div class="order-fuel">${activeFueling?.fuelName||f.stationLabel}</div><div class="order-row"><span>Всего требуется</span><strong>${f.volume} л</strong></div><div class="order-row"><span>Цена</span><strong>${price(activeFueling?.price??f.price)}</strong></div><div class="order-row"><span>Текущий заказ</span><strong>${liters} л</strong></div><div class="order-row"><span>Стоимость заказа</span><strong>${cost==null?'—':money(cost)}</strong></div><div class="order-row"><span>Доступный лимит</span><strong>${money(trip.limitLeft)}</strong></div>`;

 if(!activeFueling&&!p.possible){
  orderFuel.innerHTML+=`<div class="order-note warning">${p.reason==='below-min'?`Указанный объём ${f.volume} л ниже минимального объёма одного заказа на этой АЗС - ${stationDetails.litersMin} л. Увеличьте объём минимум до ${stationDetails.litersMin} л.`:`Указанный объём нельзя распределить по заказам в пределах ${stationDetails.litersMin}–${stationDetails.litersMax} л.`}</div>`;
  addPlanHint(0,0);
 }else{
  if(!activeFueling&&liters<f.volume)orderFuel.innerHTML+=`<div class="order-note">В текущем заказе ${liters} л. После него останется заправить ${f.volume-liters} л.</div>`;
  if(!activeFueling&&cost>trip.limitLeft)orderFuel.innerHTML+=`<div class="order-note warning">Стоимость текущего заказа превышает доступный лимит рейса.</div>`;
  else if(!activeFueling)addPlanHint(liters,cost);
 }

if(orderNotice)orderFuel.innerHTML+=`<div class="order-note problem">${orderNotice.text}</div>`;

 fuelingStatus.hidden=!activeFueling;
 fuelingStatus.textContent=activeFueling?fuelingText(activeFueling):'';
 pumpTitle.hidden=!!activeFueling;
 orderPumps.innerHTML='';

 if(!activeFueling)f.pumps.filter(x=>x.status!=='off').forEach(pump=>{
  const b=document.createElement('button');
  b.className='pump-btn'+(selectedPump===pump.number?' selected':'');
  b.disabled=pump.status!=='free'||orderSending;
  b.innerHTML=`Колонка ${pump.number}<span class="pump-status">${pump.status==='free'?'Свободна':'Занята'}</span>`;
  b.onclick=()=>{selectedPump=pump.number;pendingRequest=null;orderNotice='';renderOrder();save('order')};
  orderPumps.append(b);
 });

 orderChangeVolume.disabled=!!activeFueling||orderSending;

 if(activeFueling){
  orderSubmit.disabled=statusChecking;
  orderSubmit.textContent=statusChecking?'Проверяем статус...':'Проверить статус';
 }else{
  orderSubmit.disabled=orderSending||selectedPump==null||!p.possible||cost>trip.limitLeft;
  orderSubmit.textContent=orderSending?'Заказ отправлен - ожидайте':'Заказать';
 }

 orderBack.disabled=!!activeFueling||orderSending;
}

async function openOrder(id){
 if(!station||roundLiters(planned[id])<=0)return;
 stopLocation();stopFueling();hideError();

 try{
  await stationContext(station.station.id);

  orderFuelId=id;

  const f=fuelState(stationDetails,id);

  orderLiters=firstOrder(f.volume,stationDetails.litersMin,stationDetails.litersMax);

  selectedPump=null;
  pendingRequest=null;
  activeFueling=null;
  orderSending=false;
  statusChecking=false;
  orderNotice='';

  renderOrder();
  showPage('order');
  save('order');
 }catch(e){
  if(e.code==='NETWORK_ERROR')showError(()=>openOrder(id));
 }
}

function stopFueling(){if(fuelingTimer)clearTimeout(fuelingTimer);fuelingTimer=null}
function scheduleFuelingPoll(delay=FUELING_INTERVAL){stopFueling();if(activeFueling?.id)fuelingTimer=setTimeout(()=>pollFueling(false),delay)}
async function refreshTrip(){trip=await FakeApi.getTrip();showTrip()}

function showResult(f){
 lastResult={fuelingId:f.id,stationId:f.stationId,fuel:f.fuel,factLiters:Number(f.factLiters||0),factAmount:Number(f.factAmount||0),limitLeft:trip.limitLeft};

 resultLiters.textContent=`${lastResult.factLiters} л`;
 resultAmount.textContent=money(lastResult.factAmount);
 resultLimit.textContent=money(lastResult.limitLeft);

 resultAction.textContent=remainingFuelIds().length?'Продолжить заправку':'Вернуться на главную страницу';
 resultAction.disabled=false;

 showPage('result');
 save('result',{activeFuelingId:null});
}

async function settle(f){
 stopFueling();
 statusChecking=false;

 const cancelledLiters=roundLiters(f.liters||orderLiters);

 if(!processed.has(f.id)){
  if(f.status==='completed'){
   planned[f.fuel]=roundLiters(roundLiters(planned[f.fuel])-Number(f.factLiters||0));
  }

  processed.add(f.id);
 }

 try{
  await refreshTrip();
 }catch(e){
  if(e.code!=='NETWORK_ERROR')throw e;
 }

 activeFueling=null;
 pendingRequest=null;
 selectedPump=null;
 orderSending=false;

 if(f.status==='completed'){
  orderLiters=null;
  showResult(f);
  return;
 }

 orderLiters=cancelledLiters;

 try{
  stationDetails=await FakeApi.getStation(station.station.id);
  cache.set(stationDetails.id,stationDetails);
 }catch{}

 orderNotice={
  type:'warning',
  text:cancelText(f)
 };

 renderOrder();
 save('order',{activeFuelingId:null});
}

async function pollFueling(manual=false){
 if(!activeFueling?.id||statusChecking)return;

 stopFueling();
 statusChecking=true;

 if(manual)renderOrder();

 try{
  const f=await FakeApi.getFueling(activeFueling.id);

  activeFueling=f;
  statusChecking=false;

  if(f.status==='completed'||f.status==='cancelled'){
   await settle(f);
   return;
  }

  renderOrder();
  save('order');
  scheduleFuelingPoll();
 }catch(e){
  statusChecking=false;
  renderOrder();

  if(e.code==='NETWORK_ERROR'){
   showError(async()=>pollFueling(true));
  }else{
   orderNotice={
    type:'error',
    text:'Не удалось получить состояние заказа. Нажмите «Проверить статус» ещё раз.'
   };

   renderOrder();
  }
 }
}

async function registerFueling(f){
 activeFueling=f;
 pendingRequest=null;
 selectedPump=f.pump;
 orderLiters=f.liters;
 orderSending=false;
 statusChecking=false;

 renderOrder();
 save('order');

 scheduleFuelingPoll(100);

 try{
  await refreshTrip();
  renderOrder();
  save('order');
 }catch{}
}

function requestId(){return globalThis.crypto&&typeof crypto.randomUUID==='function'?crypto.randomUUID():'fuel_'+Date.now()+'_'+Math.random().toString(16).slice(2)}
async function refreshOrderStation(){try{stationDetails=await FakeApi.getStation(station.station.id);cache.set(stationDetails.id,stationDetails)}catch{}}
function priceChanged(a,b){return Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.round(Number(a)*100)!==Math.round(Number(b)*100)}

async function submitOrder(){
 if(activeFueling||orderSending||selectedPump==null)return;

 const{fuel,liters,cost}=currentOrder();

 if(liters==null||cost>trip.limitLeft)return;

 const key=[station.station.id,orderFuelId,selectedPump,liters,fuel.price].join('|');

 if(!pendingRequest||pendingRequest.key!==key){
  pendingRequest={
   key,
   id:requestId(),
   payload:{
    stationId:station.station.id,
    pump:selectedPump,
    fuel:orderFuelId,
    liters,
    price:fuel.price
   }
  };
 }

 orderSending=true;
 orderNotice='';

 renderOrder();
 save('order');

 try{
  const f=await FakeApi.startFueling({
   ...pendingRequest.payload,
   clientRequestId:pendingRequest.id
  });

  await registerFueling(f);
 }catch(e){
  orderSending=false;

  if(e.code==='NETWORK_ERROR'){
   renderOrder();
   save('order');
   showError(submitOrder);
   return;
  }

  const oldPrice=pendingRequest?.payload?.price;
  const failedPump=pendingRequest?.payload?.pump;

  await refreshOrderStation();

  const newPrice=stationDetails?.prices?.[orderFuelId];

  if(e.code==='PUMP_BUSY'){
   const pump=stationDetails?.pumps?.find(p=>p.number===failedPump);

   if(pump){
    pump.status='busy';
   }

   selectedPump=null;
   pendingRequest=null;

   orderNotice={
    type:'warning',
    text:'Выбранная колонка уже занята. Выберите другую свободную колонку.'
   };
  }else if(priceChanged(oldPrice,newPrice)){
   selectedPump=null;
   pendingRequest=null;

   orderNotice={
    type:'warning',
    text:`Цена изменилась: было ${price(oldPrice)}, стало ${price(newPrice)}. Проверьте новую сумму и подтвердите заказ ещё раз.`
   };
  }else if(e.code==='PRICE_CHANGED'){
   selectedPump=null;
   pendingRequest=null;

   orderNotice={
    type:'warning',
    text:'Не удалось подтвердить цену заказа. Данные АЗС обновлены. Проверьте актуальную стоимость и подтвердите заказ ещё раз.'
   };
  }else{
   pendingRequest=null;

   orderNotice={
    type:'error',
    text:e.message||'Заказ не создан. Проверьте параметры и попробуйте ещё раз.'
   };
  }

  renderOrder();
  save('order');
 }
}

async function restoreKnownFueling(id){
 if(!id)return false;

 let f;

 try{
  f=await FakeApi.getFueling(id);
 }catch(e){
  if(e.code==='NOT_FOUND')return false;
  throw e;
 }

 orderFuelId=f.fuel;
 orderLiters=f.liters;

 if(!selectedFuels.includes(f.fuel))selectedFuels.push(f.fuel);
 if(!planned[f.fuel])planned[f.fuel]=roundLiters(f.liters);

 await stationContext(f.stationId);

 activeFueling=f;
 selectedPump=f.pump;
 orderSending=false;
 statusChecking=false;
 orderNotice='';

 if(f.status==='completed'||f.status==='cancelled'){
  await settle(f);
 }else{
  renderOrder();
  showPage('order');
  save('order');
  scheduleFuelingPoll(100);
 }

 return true;
}

async function restore(){
 const s=saved();

 selectedFuels=loadFuels();

 if(s?.planned){
  planned={};
  Object.entries(s.planned).forEach(([id,v])=>planned[id]=roundLiters(v));
 }

 if(s?.processed)processed=new Set(s.processed);
 if(s?.lastResult)lastResult=s.lastResult;
 if(s?.pendingRequest)pendingRequest=s.pendingRequest;
 if(s?.orderLiters!=null)orderLiters=roundLiters(s.orderLiters);

 const active=await FakeApi.getActiveFueling();

 if(active){
  orderFuelId=active.fuel;
  orderLiters=active.liters;

  if(!selectedFuels.includes(active.fuel))selectedFuels.push(active.fuel);
  if(!planned[active.fuel])planned[active.fuel]=roundLiters(active.liters);

  await stationContext(active.stationId);

  activeFueling=active;
  selectedPump=active.pump;
  orderSending=false;
  statusChecking=false;
  orderNotice='';

  renderOrder();
  showPage('order');
  save('order');
  scheduleFuelingPoll(100);
  return;
 }

 if(s?.activeFuelingId&&await restoreKnownFueling(s.activeFuelingId))return;

 if(s?.screen==='result'&&lastResult){
  await refreshTrip();

  resultLiters.textContent=`${lastResult.factLiters} л`;
  resultAmount.textContent=money(lastResult.factAmount);
  resultLimit.textContent=money(trip.limitLeft);
  resultAction.textContent=remainingFuelIds().length?'Продолжить заправку':'Вернуться на главную страницу';

  showPage('result');
  return;
 }

 if(!s)return;

 if(s.screen==='fuel'){openFuel('main');return}
 if(s.screen==='volume'){openVolume('main');return}
 if(s.screen==='stations'){await openStations(s.searchQuery||'');return}

 if((s.screen==='station'||s.screen==='order')&&s.stationId){
  await stationContext(s.stationId);

  if(s.screen==='order'&&s.orderFuelId&&roundLiters(planned[s.orderFuelId])>0){
   orderFuelId=s.orderFuelId;
   selectedPump=null;
   orderSending=false;
   statusChecking=false;
   orderNotice='';

   renderOrder();
   showPage('order');
   save('order');
  }else{
   orderLiters=null;

   renderStation();
   showPage('station');
   save('station');
  }
 }
}

$('start-fueling-btn').onclick=startFlow;

fuelContinue.onclick=()=>{
 selectedFuels=FUELS.filter(([id])=>draftFuels.has(id)).map(([id])=>id);

 Object.keys(planned).forEach(id=>{
  if(!selectedFuels.includes(id))delete planned[id];
 });

 saveFuels();
 renderSelectedFuels();

 openVolume(fuelReturn==='stations'?'stations':'main');
};

$('fuel-back-btn').onclick=()=>{
 if(fuelReturn==='stations'){
  showPage('stations');
  startLocation();
  save('stations');
 }else if(fuelReturn==='volume'){
  showPage('volume');
  renderVolumes();
  save('volume');
 }else{
  hidePages();
  clearSaved();
 }
};

$('volume-change-fuels-btn').onclick=()=>openFuel('volume');

volumeContinue.onclick=async()=>{
 if(!volumeContinue.disabled)await openStations();
};

$('volume-back-btn').onclick=()=>{
 if(volumeReturn==='stations'){
  showPage('stations');
  startLocation();
  save('stations');
 }else{
  hidePages();
  clearSaved();
 }
};

$('change-fuel-btn').onclick=()=>openFuel('stations');
stationSearch.oninput=searchStations;

$('back-btn').onclick=()=>{
 stopLocation();
 clearSaved();
 hidePages();
};

$('station-back-btn').onclick=()=>{
 showPage('stations');
 startLocation();
 save('stations');
};

orderBack.onclick=()=>{
 if(activeFueling||orderSending)return;

 orderLiters=null;
 orderVolumeEditor.classList.remove('visible');
 orderChangeVolume.hidden=false;

 showPage('station');
 renderStation();
 save('station');
};

orderChangeVolume.onclick=()=>{
 if(activeFueling||orderSending)return;

 const current=currentOrder();

 if(current.liters==null)return;

 orderDraftVolume=current.liters;

 orderChangeVolume.hidden=true;
 orderVolumeEditor.classList.add('visible');

 buildWheel(
  orderVolumeWheel,
  orderDraftVolume,
  v=>orderDraftVolume=v,
  stationDetails.litersMin,
  stationDetails.litersMax
 );
};

$('order-volume-save').onclick=()=>{
 if(activeFueling||orderSending||!(orderDraftVolume>0))return;

 orderLiters=roundLiters(orderDraftVolume);

 if(orderLiters>roundLiters(planned[orderFuelId])){
  planned[orderFuelId]=orderLiters;
 }

 selectedPump=null;
 pendingRequest=null;
 orderNotice='';

 orderVolumeEditor.classList.remove('visible');
 orderChangeVolume.hidden=false;

 renderOrder();
 save('order');
};

orderSubmit.onclick=()=>{
 activeFueling
  ?pollFueling(true)
  :submitOrder();
};

resultAction.onclick=async()=>{
 if(resultAction.disabled)return;

 const destination=
  lastResult?.stationId||
  station?.station?.id||
  saved()?.stationId;

 if(remainingFuelIds().length){
  resultAction.disabled=true;
  resultAction.textContent='Обновляем данные...';

  try{
   await stationContext(destination);

   lastResult=null;
   orderLiters=null;

   renderStation();
   showPage('station');

   save('station',{activeFuelingId:null});
  }catch(e){
   resultAction.disabled=false;
   resultAction.textContent='Продолжить заправку';

   if(e.code==='NETWORK_ERROR'){
    showError(resultAction.onclick);
   }
  }
 }else{
  resultAction.disabled=true;

  try{
   await refreshTrip();

   lastResult=null;
   activeFueling=null;
   orderFuelId=null;
   orderLiters=null;
   selectedPump=null;
   pendingRequest=null;

   clearSaved();
   hidePages();
  }catch(e){
   resultAction.disabled=false;
   resultAction.textContent='Вернуться на главную страницу';

   if(e.code==='NETWORK_ERROR'){
    showError(resultAction.onclick);
   }
  }
 }
};

async function init(){
 try{
  trip=await FakeApi.getTrip();

  ensureMovement();
  showTrip();

  await restore();

  app.classList.remove('restoring');
 }catch(e){
  if(e.code==='NETWORK_ERROR'){
   showError(init);
  }else{
   app.classList.remove('restoring');
  }
 }
}

init();