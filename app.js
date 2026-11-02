const $=id=>document.getElementById(id);

const pages=['fuel','volume','stations','best','station','order','result']
 .map(x=>$(`${x}-page`));

const app=$('app'),
 tripDate=$('trip-date'),
 tripRoute=$('trip-route'),
 tripTruck=$('trip-truck'),
 limitLeft=$('limit-left'),
 limitTotal=$('limit-total'),
 limitFill=$('limit-progress-fill'),
 errorOverlay=$('error-overlay'),
 retryBtn=$('retry-btn'),
 fuelOptions=$('fuel-options'),
 fuelContinue=$('fuel-continue-btn'),
 volumeList=$('volume-list'),
 volumeContinue=$('volume-continue-btn'),
 selectedFuelsEl=$('selected-fuels'),
 stationSearch=$('station-search'),
 stationList=$('station-list'),
 searchMessage=$('search-message'),
 stationWarning=$('station-warning'),
 bestStationBtn=$('best-station-btn'),
 bestWarning=$('best-warning'),
 bestMessage=$('best-message'),
 bestList=$('best-list'),
 stationMain=$('station-main-card'),
 bestAlternative=$('best-alternative'),
 stationLimit=$('station-limit-card'),
 detailFuels=$('detail-fuels'),
 stationSummary=$('station-summary'),
 orderStation=$('order-station-card'),
 orderFuel=$('order-fuel-card'),
 orderPumps=$('order-pump-list'),
 orderSubmit=$('order-submit-btn'),
 orderBack=$('order-back-btn'),
 orderChangeVolume=$('order-change-volume-btn'),
 orderVolumeEditor=$('order-volume-editor'),
 orderVolumeWheel=$('order-volume-wheel'),
 fuelingStatus=$('fueling-status'),
 pumpTitle=$('pump-title'),
 resultLiters=$('result-liters'),
 resultAmount=$('result-amount'),
 resultLimit=$('result-limit'),
 resultAction=$('result-action-btn');

const SESSION='fuelingUiSession',
 LOCATION_INTERVAL=60000,
 DIRECTION_INTERVAL=300000,
 MIN_MOVE=.5,
 DIRECTION_MAX_AGE=600000,
 FUELING_INTERVAL=1500,
 MAX_VOLUME=2000,
 ROUTE_DEVIATION=1.4,
 MIN_ROUTE_MARGIN=50,
 MAX_BACKWARD_DISTANCE=100;

const FUELS=[
 ['diesel','Дизель'],
 ['diesel_premium','Премиальный дизель'],
 ['diesel_winter','Зимний дизель'],
 ['propane','Пропан'],
 ['ai100','АИ-100'],
 ['ai95','АИ-95'],
 ['ai92','АИ-92']
];

const CITIES={
 'Москва':{lat:55.75,lon:37.62},
 'Казань':{lat:55.79,lon:49.12}
};

let trip=null,
 stations=[],
 driverLocation=null,
 selectedFuels=[],
 draftFuels=new Set(),
 planned={},
 fuelReturn='main',
 volumeReturn='main',
 stationReturn='stations',
 station=null,
 stationDetails=null,
 orderFuelId=null,
 orderLiters=null,
 selectedPump=null,
 pendingRequest=null,
 activeFueling=null,
 lastResult=null,
 orderSending=false,
 statusChecking=false,
 orderNotice='',
 retryAction=null,
 locationTimer=null,
 fuelingTimer=null,
 searchVersion=0,
 cache=new Map(),
 processed=new Set(),
 movement=loadMovement(),
 orderDraftVolume=null;

const money=v=>
 new Intl.NumberFormat('ru-RU',{
  maximumFractionDigits:2
 }).format(v)+' ₽';

const price=v=>
 new Intl.NumberFormat('ru-RU',{
  minimumFractionDigits:2,
  maximumFractionDigits:2
 }).format(v)+' ₽/л';

const fuelLabel=id=>
 FUELS.find(x=>x[0]===id)?.[1]||id;

const roundLiters=v=>
 Math.max(0,Math.round(Number(v)||0));

const remainingFuelIds=()=>
 selectedFuels.filter(
  id=>roundLiters(planned[id])>0
 );

const sleep=ms=>
 new Promise(resolve=>setTimeout(resolve,ms));

async function readApi(fn,attempts=3){
 let lastError;

 for(let i=0;i<attempts;i++){
  try{
   return await fn();

  }catch(e){
   lastError=e;

   if(
    e.code!=='NETWORK_ERROR'||
    i===attempts-1
   ){
    throw e;
   }

   await sleep(250*(i+1));
  }
 }

 throw lastError;
}

function hidePages(){
 pages.forEach(
  p=>p.classList.remove('visible')
 );
}

function showPage(name){
 hidePages();
 $(`${name}-page`).classList.add('visible');
}

function showTrip(){
 tripDate.textContent=
  new Intl.DateTimeFormat(
   'ru-RU',
   {
    day:'numeric',
    month:'long'
   }
  ).format(
   new Date(
    trip.date+'T00:00:00'
   )
  );

 tripRoute.textContent=
  `${trip.from} → ${trip.to}`;

 tripTruck.textContent=
  `Тягач ${trip.truck}`;

 limitLeft.textContent=
  money(trip.limitLeft);

 limitTotal.textContent=
  money(trip.limitTotal);

 limitFill.style.width=
  `${Math.min(
   100,
   trip.limitTotal
    ?trip.limitLeft/trip.limitTotal*100
    :0
  )}%`;
}

function save(screen,extra={}){
 sessionStorage.setItem(
  SESSION,
  JSON.stringify({
   screen,
   planned,
   searchQuery:
    stationSearch.value||'',
   stationReturn,
   stationId:
    station?.station?.id||
    activeFueling?.stationId||
    null,
   orderFuelId,
   orderLiters,
   activeFuelingId:
    activeFueling?.id||
    extra.activeFuelingId||
    null,
   pendingRequest,
   lastResult,
   processed:[...processed],
   ...extra
  })
 );
}

function saved(){
 try{
  return JSON.parse(
   sessionStorage.getItem(SESSION)
  );
 }catch{
  return null;
 }
}

function clearSaved(){
 sessionStorage.removeItem(SESSION);
}

function showError(action){
 retryAction=action;
 errorOverlay.classList.add('visible');
}

function hideError(){
 errorOverlay.classList.remove('visible');
}

retryBtn.onclick=async()=>{
 const action=retryAction;

 retryAction=null;
 hideError();

 if(action){
  await action();
 }
};

function buildWheel(
 host,
 value,
 onChange,
 min=0,
 max=MAX_VOLUME
){
 host.innerHTML='';

 const wrap=document.createElement('div'),
       list=document.createElement('div'),
       focus=document.createElement('div'),
       unit=document.createElement('div'),
       values=Array.from(
        {length:max-min+1},
        (_,i)=>min+i
       );

 wrap.className='wheel-wrap';
 list.className='wheel-list';
 focus.className='wheel-focus';
 unit.className='wheel-unit';
 unit.textContent='л';

 list.style.paddingBottom='100px';

 values.forEach(v=>{
  const item=
   document.createElement('div');

  item.className='wheel-item';
  item.textContent=v||'—';
  item.dataset.value=v;

  list.append(item);
 });

 wrap.append(
  list,
  focus,
  unit
 );

 host.append(wrap);

 let current=
  Math.max(
   min,
   Math.min(
    max,
    Math.round(
     Number(value)||min
    )
   )
  );

 const currentIndex=
  values.indexOf(current);

 const paint=i=>
  [...list.children]
   .forEach(
    (el,n)=>
     el.classList.toggle(
      'active',
      n===i
     )
   );

 function select(){
  const i=
   Math.max(
    0,
    Math.min(
     values.length-1,
     Math.round(
      list.scrollTop/50
     )
    )
   );

  const v=values[i];

  paint(i);

  if(v!==current){
   current=v;
   onChange(v);
  }
 }

 requestAnimationFrame(()=>{
  list.scrollTop=
   currentIndex*50;

  paint(currentIndex);
 });

 let timer;

 list.addEventListener(
  'scroll',
  ()=>{
   clearTimeout(timer);
   timer=setTimeout(select,80);
  }
 );
}

function fuelKey(){
 return trip
  ?`fuelSelection_${trip.id}`
  :null;
}

function loadFuels(){
 try{
  const x=
   JSON.parse(
    localStorage.getItem(
     fuelKey()
    )
   );

  const valid=
   FUELS.map(x=>x[0]);

  return Array.isArray(x)
   ?x.filter(
     id=>valid.includes(id)
    )
   :[];

 }catch{
  return[];
 }
}

function saveFuels(){
 localStorage.setItem(
  fuelKey(),
  JSON.stringify(selectedFuels)
 );
}

function renderFuelOptions(){
 fuelOptions.innerHTML='';

 FUELS.forEach(
  ([id,label])=>{
   const b=
    document.createElement(
     'button'
    );

   b.className=
    'fuel-option'+
    (
     draftFuels.has(id)
      ?' selected'
      :''
    );

   b.textContent=label;

   if(draftFuels.has(id)){
    const s=
     document.createElement(
      'span'
     );

    s.className=
     'fuel-option-check';

    s.textContent='✓';

    b.append(s);
   }

   b.onclick=()=>{
    draftFuels.has(id)
     ?draftFuels.delete(id)
     :draftFuels.add(id);

    renderFuelOptions();
   };

   fuelOptions.append(b);
  }
 );

 fuelContinue.disabled=
  !draftFuels.size;
}

function openFuel(returnTo){
 stopLocation();

 fuelReturn=returnTo;

 draftFuels=
  new Set(selectedFuels);

 showPage('fuel');
 renderFuelOptions();
 save('fuel');
}

function renderSelectedFuels(){
 selectedFuelsEl.textContent=
  selectedFuels
   .map(fuelLabel)
   .join(', ');
}

function validateVolumes(){
 volumeContinue.disabled=
  !selectedFuels.length||
  selectedFuels.some(
   id=>
    roundLiters(
     planned[id]
    )<=0
  );
}

function renderVolumes(){
 volumeList.innerHTML='';

 selectedFuels.forEach(id=>{
  const card=
   document.createElement('div');

  const name=
   document.createElement('div');

  const wheel=
   document.createElement('div');

  card.className=
   'volume-card';

  name.className=
   'volume-fuel-name';

  name.textContent=
   fuelLabel(id);

  card.append(
   name,
   wheel
  );

  volumeList.append(card);

  buildWheel(
   wheel,
   roundLiters(
    planned[id]
   ),
   v=>{
    if(v>0){
     planned[id]=v;
    }else{
     delete planned[id];
    }

    validateVolumes();
    save('volume');
   }
  );
 });

 validateVolumes();
}

function openVolume(
 returnTo='main'
){
 volumeReturn=returnTo;

 showPage('volume');
 renderVolumes();
 save('volume');
}

async function startFlow(){
 try{
  hideError();

  trip=
   await readApi(
    ()=>FakeApi.getTrip()
   );

  showTrip();

  selectedFuels=
   loadFuels();

  planned={};

  selectedFuels.length
   ?openVolume('main')
   :openFuel('main');

 }catch(e){
  if(
   e.code==='NETWORK_ERROR'
  ){
   showError(startFlow);
  }
 }
}

function emptyMovement(){
 return{
  tripId:null,
  reference:null,
  direction:null
 };
}

function loadMovement(){
 try{
  return{
   ...emptyMovement(),
   ...JSON.parse(
    localStorage.getItem(
     'driverMovementState'
    )
   )
  };
 }catch{
  return emptyMovement();
 }
}

function saveMovement(){
 localStorage.setItem(
  'driverMovementState',
  JSON.stringify(movement)
 );
}

function ensureMovement(){
 if(
  !trip||
  movement.tripId===trip.id
 ){
  return;
 }

 movement=
  emptyMovement();

 movement.tripId=
  trip.id;

 saveMovement();
}

function rememberLocation(loc){
 ensureMovement();

 const p={
  lat:loc.lat,
  lon:loc.lon,
  timestamp:Date.now()
 };

 if(!movement.reference){
  movement.reference=p;
  saveMovement();
  return;
 }

 if(
  p.timestamp-
  movement.reference.timestamp>=
  DIRECTION_INTERVAL
 ){
  const d=
   distance(
    movement.reference.lat,
    movement.reference.lon,
    p.lat,
    p.lon
   );

  movement.direction=
   d>=MIN_MOVE
    ?{
      from:movement.reference,
      to:p,
      confirmedAt:p.timestamp
     }
    :null;

  movement.reference=p;

  saveMovement();
 }
}

async function updateLocation(
 showErr=false
){
 try{
  driverLocation=
   await readApi(
    ()=>FakeApi.getDriverLocation()
   );

  rememberLocation(
   driverLocation
  );

  return true;

 }catch(e){
  if(
   showErr&&
   e.code==='NETWORK_ERROR'
  ){
   showError(loadStations);
  }

  return false;
 }
}

async function loadStations(){
 hideError();

 if(
  !await updateLocation(true)
 ){
  return false;
 }

 try{
  stations=
   await readApi(
    ()=>FakeApi.getStations()
   );

  return true;

 }catch(e){
  if(
   e.code==='NETWORK_ERROR'
  ){
   showError(loadStations);
  }

  return false;
 }
}

async function ensureStationData(){
 if(!driverLocation){
  driverLocation=
   await readApi(
    ()=>FakeApi.getDriverLocation()
   );

  rememberLocation(
   driverLocation
  );
 }

 if(!stations.length){
  stations=
   await readApi(
    ()=>FakeApi.getStations()
   );
 }
}

function startLocation(){
 stopLocation();

 locationTimer=
  setInterval(
   ()=>updateLocation(false),
   LOCATION_INTERVAL
  );
}

function stopLocation(){
 if(locationTimer){
  clearInterval(
   locationTimer
  );
 }

 locationTimer=null;
}

function distance(
 a,b,c,d
){
 const r=6371;

 const p=x=>
  x*Math.PI/180;

 const d1=
  p(c-a);

 const d2=
  p(d-b);

 const q=
  Math.sin(d1/2)**2+
  Math.cos(p(a))*
  Math.cos(p(c))*
  Math.sin(d2/2)**2;

 return r*2*
  Math.atan2(
   Math.sqrt(q),
   Math.sqrt(1-q)
  );
}

function directionVector(){
 const d=
  movement.direction;

 return d&&
  Date.now()-d.confirmedAt<=
  DIRECTION_MAX_AGE
   ?d
   :null;
}

function stationDirection(s){
 const d=
  directionVector();

 if(!driverLocation||!d){
  return'unknown';
 }

 const scale=
  Math.cos(
   (
    driverLocation.lat+
    s.lat
   )/
   2*
   Math.PI/180
  );

 const ax=
  (
   d.to.lon-
   d.from.lon
  )*
  scale;

 const ay=
  d.to.lat-
  d.from.lat;

 const bx=
  (
   s.lon-
   driverLocation.lon
  )*
  scale;

 const by=
  s.lat-
  driverLocation.lat;

 return ax*bx+ay*by>=0
  ?'forward'
  :'backward';
}

function inTripArea(s){
 const a=
  CITIES[trip.from];

 const b=
  CITIES[trip.to];

 if(!a||!b){
  return true;
 }

 const d=
  distance(
   a.lat,
   a.lon,
   b.lat,
   b.lon
  );

 return distance(
  a.lat,
  a.lon,
  s.lat,
  s.lon
 )+
 distance(
  s.lat,
  s.lon,
  b.lat,
  b.lon
 )<=
 Math.max(
  d*ROUTE_DEVIATION,
  d+MIN_ROUTE_MARGIN
 );
}

async function details(
 id,
 force=false
){
 if(
  !force&&
  cache.has(id)
 ){
  return cache.get(id);
 }

 try{
  const x=
   await readApi(
    ()=>FakeApi.getStation(id)
   );

  cache.set(id,x);

  return x;

 }catch(e){
  if(
   force||
   e.code==='NETWORK_ERROR'
  ){
   throw e;
  }

  return null;
 }
}

function stationFuelName(
 d,
 id
){
 const f=
  d?.fuels;

 if(Array.isArray(f)){
  const x=
   f.find(v=>
    typeof v==='string'
     ?v===id
     :v?.id===id||
      v?.code===id
   );

  if(
   typeof x==='object'&&
   x
  ){
   return(
    x.name||
    x.title||
    x.label||
    fuelLabel(id)
   );
  }
 }

 if(
  f&&
  typeof f==='object'&&
  !Array.isArray(f)
 ){
  const x=
   f[id];

  if(
   typeof x==='string'
  ){
   return x;
  }

  if(x){
   return(
    x.name||
    x.title||
    x.label||
    fuelLabel(id)
   );
  }
 }

 return fuelLabel(id);
}

function fuelState(
 d,
 id
){
 const volume=
  roundLiters(
   planned[id]
  );

 const base={
  id,
  label:
   fuelLabel(id),
  stationLabel:
   stationFuelName(
    d,
    id
   ),
  volume
 };

 if(
  !Object.hasOwn(
   d.prices,
   id
  )
 ){
  return{
   ...base,
   status:'missing',
   available:false,
   price:null,
   pumps:[]
  };
 }

 const pumps=
  d.pumps.filter(
   p=>
    p.fuels.includes(id)
  );

 const free=
  pumps.filter(
   p=>p.status==='free'
  );

 const busy=
  pumps.filter(
   p=>p.status==='busy'
  );

 if(
  !free.length&&
  !busy.length
 ){
  return{
   ...base,
   status:'unavailable',
   available:false,
   price:d.prices[id],
   pumps
  };
 }

 return{
  ...base,
  status:
   volume<d.litersMin
    ?'below-min'
    :free.length
     ?'ready'
     :'busy',
  available:true,
  price:d.prices[id],
  pumps
 };
}

/* Ручной поиск работает по уже загруженному getStations(). */
function manualSearchItems(q){
 const words=
  q.trim()
   .toLowerCase()
   .split(/\s+/)
   .filter(Boolean);

 return stations
  .filter(inTripArea)
  .filter(s=>{
   const text=
    (
     s.brand+' '+
     s.name+' '+
     s.address
    ).toLowerCase();

   return words.every(
    word=>
     text.includes(word)
   );
  })
  .filter(s=>
   remainingFuelIds()
    .some(id=>
     Object.hasOwn(
      s.prices,
      id
     )
    )
  )
  .map(s=>({
   station:s,

   distance:
    distance(
     driverLocation.lat,
     driverLocation.lon,
     s.lat,
     s.lon
    ),

   direction:
    stationDirection(s)
  }))
  .filter(x=>
   x.direction!=='backward'||
   x.distance<=
    MAX_BACKWARD_DISTANCE
  )
  .sort(compare);
}

function compare(a,b){
 if(
  !directionVector()
 ){
  return(
   a.distance-
   b.distance
  );
 }

 const order={
  forward:0,
  unknown:1,
  backward:2
 };

 return(
  order[a.direction]-
  order[b.direction]||
  a.distance-
  b.distance
 );
}

function dirText(d){
 return d==='forward'
  ?'В направлении движения'
  :d==='backward'
   ?'В обратном направлении'
   :'';
}

function renderManualStationCard(x){
 const b=
  document.createElement(
   'button'
  );

 const dir=
  dirText(
   x.direction
  );

 b.className=
  'station-item';

 b.innerHTML=
  `<div class="station-name">${x.station.name}</div>

   <div class="station-info">
    <span class="station-distance">
     ${x.distance.toFixed(1)} км по прямой
    </span>

    ${dir
      ?`<span class="station-direction">${dir}</span>`
      :''
    }
   </div>`;

 remainingFuelIds()
  .forEach(id=>{
   const row=
    document.createElement(
     'div'
    );

   const hasFuel=
    Object.hasOwn(
     x.station.prices,
     id
    );

   row.className=
    `station-fuel-row ${
     hasFuel
      ?'ready'
      :'missing'
    }`;

   row.textContent=
    hasFuel
     ?`${fuelLabel(id)} - ${price(x.station.prices[id])}`
     :`${fuelLabel(id)} - нет на этой АЗС`;

   b.append(row);
  });

 const address=
  document.createElement(
   'div'
  );

 address.className=
  'station-address';

 address.textContent=
  x.station.address;

 b.append(address);

 b.onclick=()=>
  openStation(
   x,
   'stations'
  );

 stationList.append(b);
}

function showManualWarning(){
 stationWarning.style.display=
  'block';

 stationWarning.textContent=
  directionVector()
   ?'Проверьте сторону расположения АЗС на дороге'
   :'Направление движения не известно, проверяйте расположение АЗС на карте.';
}

function searchStations(){
 ++searchVersion;

 const q=
  stationSearch
   .value
   .trim();

 save(
  'stations',
  {
   searchQuery:q
  }
 );

 stationList.innerHTML='';
 searchMessage.textContent='';

 if(!q){
  stationWarning.style.display=
   'none';

  return;
 }

 showManualWarning();

 const items=
  manualSearchItems(q);

 if(!items.length){
  searchMessage.textContent=
   'Подходящие АЗС не найдены.';

  return;
 }

 items.forEach(
  renderManualStationCard
 );
}

async function openStations(
 query=''
){
 cache=
  new Map();

 searchVersion++;

 renderSelectedFuels();

 stationSearch.value=
  query;

 stationList.innerHTML='';
 searchMessage.textContent='';

 stationWarning.style.display=
  'none';

 bestStationBtn.disabled=
  false;

 showPage('stations');

 if(
  await loadStations()
 ){
  startLocation();

  if(query){
   searchStations();
  }else{
   stationSearch.focus();
  }

  save(
   'stations',
   {
    searchQuery:query
   }
  );
 }
}

function orderPlan(
 v,
 min,
 max
){
 if(v<min){
  return{
   possible:false,
   reason:'below-min',
   orders:0
  };
 }

 const orders=
  Math.ceil(v/max);

 return{
  possible:
   v>=orders*min,
  reason:
   v>=orders*min
    ?''
    :'cannot-split',
  orders
 };
}

function orderWord(n){
 const n100=n%100;
 const n10=n%10;

 return n100>=11&&
  n100<=14
   ?'заказов'
   :n10===1
    ?'заказ'
    :n10>=2&&
     n10<=4
     ?'заказа'
     :'заказов';
}

function firstOrder(
 v,
 min,
 max
){
 const p=
  orderPlan(
   v,
   min,
   max
  );

 if(!p.possible){
  return null;
 }

 return p.orders===1
  ?v
  :Math.min(
   max,
   v-
   (
    p.orders-1
   )*
   min
  );
}

function coarseFuelStations(id){
 return stations
  .filter(
   s=>
    Object.hasOwn(
     s.prices,
     id
    )
  )
  .filter(inTripArea)
  .map(s=>({
   station:s,

   distance:
    distance(
     driverLocation.lat,
     driverLocation.lon,
     s.lat,
     s.lon
    ),

   direction:
    stationDirection(s)
  }))
  .filter(
   x=>
    x.direction!=='backward'||
    x.distance<=
     MAX_BACKWARD_DISTANCE
  )
  .sort(
   (a,b)=>
    a.distance-
    b.distance
  );
}

async function fuelCandidates(id){
 const coarse=
  coarseFuelStations(id);

 const checked=
  await Promise.allSettled(
   coarse.map(
    async x=>{
     const d=
      await details(
       x.station.id
      );

     if(!d){
      return null;
     }

     const f=
      fuelState(
       d,
       id
      );

     const p=
      orderPlan(
       f.volume,
       d.litersMin,
       d.litersMax
      );

     if(
      !f.available||
      !p.possible||
      !f.pumps.some(
       pump=>
        pump.status==='free'
      )
     ){
      return null;
     }

     return{
      ...x,
      details:d,
      fuel:f
     };
    }
   )
  );

 const result=
  checked
   .filter(
    x=>
     x.status==='fulfilled'&&
     x.value
   )
   .map(
    x=>x.value
   )
   .sort(
    (a,b)=>
     a.distance-
     b.distance
   );

 const failed=
  checked.filter(
   x=>x.status==='rejected'
  );

 if(
  !result.length&&
  failed.length&&
  failed.length===checked.length
 ){
  throw failed[0].reason;
 }

 return result;
}

function comparisonData(
 basePrice,
 stationPrice,
 volume
){
 if(
  !Number.isFinite(
   Number(basePrice)
  )||
  !Number.isFinite(
   Number(stationPrice)
  )
 ){
  return null;
 }

 const difference=
  (
   Number(basePrice)-
   Number(stationPrice)
  )*
  volume;

 return{
  difference,
  saving:
   difference>0.005
 };
}

function fuelComparison(
 basePrice,
 stationPrice,
 volume
){
 const data=
  comparisonData(
   basePrice,
   stationPrice,
   volume
  );

 if(!data){
  return'';
 }

 if(
  data.difference>0.005
 ){
  return(
   `<div class="best-result-saving">
     Экономия ${money(data.difference)}
    </div>`
  );
 }

 if(
  data.difference<-.005
 ){
  return(
   `<div class="best-result-loss">
     Переплата ${money(Math.abs(data.difference))}
    </div>`
  );
 }

 return(
  `<div class="best-result-same">
    ${price(stationPrice)}
   </div>`
 );
}

async function buildUnifiedBestList(ids){
 const candidatesByFuel=
  new Map();

 const bases=
  new Map();

 const stationMap=
  new Map();

 for(const id of ids){
  const candidates=
   await fuelCandidates(id);

  candidatesByFuel.set(
   id,
   new Map(
    candidates.map(
     x=>[
      x.station.id,
      x
     ]
    )
   )
  );

  if(candidates.length){
   bases.set(
    id,
    candidates[0]
   );
  }

  candidates.forEach(x=>{
   if(
    !stationMap.has(
     x.station.id
    )
   ){
    stationMap.set(
     x.station.id,
     {
      station:x.station,
      details:x.details,
      distance:x.distance,
      direction:x.direction
     }
    );
   }
  });
 }

 let nearest=null;

 if(ids.length===1){
  const first=
   bases.get(
    ids[0]
   );

  if(first){
   nearest={
    station:first.station,
    details:first.details,
    distance:first.distance,
    direction:first.direction
   };
  }

 }else{
  const common=
   [...stationMap.values()]
    .filter(x=>
     ids.every(id=>
      candidatesByFuel
       .get(id)
       ?.has(
        x.station.id
       )
     )
    )
    .sort(
     (a,b)=>
      a.distance-
      b.distance
    );

  nearest=
   common[0]||null;
 }

 if(!nearest){
  return{
   nearest:null,
   alternatives:[],
   bases
  };
 }

 const alternatives=
  [...stationMap.values()]
   .filter(
    x=>
     x.station.id!==
     nearest.station.id
   )
   .filter(x=>
    ids.some(id=>{
     const candidate=
      candidatesByFuel
       .get(id)
       ?.get(
        x.station.id
       );

     const base=
      bases.get(id);

     if(
      !candidate||
      !base
     ){
      return false;
     }

     return(
      candidate.fuel.price<
      base.fuel.price
     );
    })
   )
   .map(x=>({
    ...x,

    distanceFromNearest:
     distance(
      nearest.station.lat,
      nearest.station.lon,
      x.station.lat,
      x.station.lon
     )
   }))
   .sort(
    (a,b)=>
     a.distanceFromNearest-
     b.distanceFromNearest
   );

 return{
  nearest,
  alternatives,
  bases
 };
}

/*
 Универсальная отрисовка ВСЕХ выбранных видов топлива.
 selectedBaseDetails передаётся отдельно для ручного сценария,
 чтобы асинхронные операции не зависели от глобального stationDetails.
*/
function renderFuelRows(
 button,
 x,
 bases,
 ids,
 comparisonMode='base',
 selectedBaseDetails=null
){
 ids.forEach(id=>{
  const row=
   document.createElement(
    'div'
   );

  row.className=
   'best-result-line';

  const volume=
   roundLiters(
    planned[id]
   );

  if(
   !Object.hasOwn(
    x.details.prices,
    id
   )
  ){
   row.innerHTML=
    `<div class="best-result-line-main">
      <div class="best-result-fuel">${fuelLabel(id)}</div>
     </div>

     <div class="best-result-line-side">
      <div class="best-result-address">Не продаётся</div>
     </div>`;

   button.append(row);

   return;
  }

  const stationPrice=
   Number(
    x.details.prices[id]
   );

  const label=
   stationFuelName(
    x.details,
    id
   );

  let right='';

  if(
   comparisonMode==='selected'
  ){
   if(
    selectedBaseDetails&&
    Object.hasOwn(
     selectedBaseDetails.prices,
     id
    )
   ){
    right=
     fuelComparison(
      Number(
       selectedBaseDetails.prices[id]
      ),
      stationPrice,
      volume
     );

   }else{
    right=
     '<div class="best-result-same">На выбранной АЗС не продаётся</div>';
   }

  }else{
   const base=
    bases.get(id);

   if(base){
    right=
     fuelComparison(
      Number(
       base.fuel.price
      ),
      stationPrice,
      volume
     );
   }
  }

  row.innerHTML=
   `<div class="best-result-line-main">
     <div class="best-result-fuel">${label} · ${volume} л</div>
     <div class="best-result-price">${price(stationPrice)}</div>
    </div>

    <div class="best-result-line-side">
     ${right}
    </div>`;

  button.append(row);
 });
}

function renderNearestStation(
 x,
 bases,
 ids
){
 const b=
  document.createElement(
   'button'
  );

 const dir=
  dirText(
   x.direction
  );

 b.className=
  'best-result-card base';

 b.innerHTML=
  `<div class="best-result-head">
    <div class="best-result-head-main">
     <div class="station-name">
      ${x.station.name}
     </div>
    </div>

    <div class="best-result-head-side">
     <div class="best-base-badge">
      Ближайшая подходящая
     </div>
    </div>
   </div>

   <div class="best-nearest-meta">
    <div class="best-nearest-address">
     ${x.station.address}
    </div>

    <div>
     <div class="best-nearest-distance">
      ${x.distance.toFixed(1)} км по прямой
     </div>

     ${dir
       ?`<div class="station-direction">${dir}</div>`
       :''
     }
    </div>
   </div>`;

 renderFuelRows(
  b,
  x,
  bases,
  ids
 );

 b.onclick=()=>
  openStation(
   x,
   'best'
  );

 bestList.append(b);
}

function renderAlternativeStation(
 x,
 bases,
 ids
){
 const b=
  document.createElement(
   'button'
  );

 const dir=
  dirText(
   x.direction
  );

 b.className=
  'best-result-card';

 b.innerHTML=
  `<div class="best-result-head">
    <div class="best-result-head-main">
     <div class="station-name">
      ${x.station.name}
     </div>

     <div class="station-info">
      <span class="station-distance">
       ${x.distance.toFixed(1)} км по прямой
      </span>

      ${dir
        ?`<span class="station-direction">${dir}</span>`
        :''
      }
     </div>
    </div>

    <div class="best-result-head-side">
     <div class="best-result-address">
      ${x.station.address}
     </div>
    </div>
   </div>`;

 renderFuelRows(
  b,
  x,
  bases,
  ids
 );

 b.onclick=()=>
  openStation(
   x,
   'best'
  );

 bestList.append(b);
}

async function openBestStations(){
 stopLocation();

 showPage('best');

 bestList.innerHTML='';

 bestMessage.textContent=
  'Подбираем АЗС...';

 if(!directionVector()){
  bestWarning.style.display=
   'block';

  bestWarning.textContent=
   'Направление движения не известно. Для его идентификации начните движение. Для точного выбора АЗС - проверяйте их расположение на карте.';
 }else{
  bestWarning.style.display=
   'none';
 }

 save('best');

 try{
  await ensureStationData();

  const ids=
   [...remainingFuelIds()];

  bestList.innerHTML='';
  bestMessage.textContent='';

  if(!ids.length){
   bestMessage.textContent=
    'Подходящих вариантов нет.';

   return;
  }

  const{
   nearest,
   alternatives,
   bases
  }=
   await buildUnifiedBestList(
    ids
   );

  if(!nearest){
   bestMessage.textContent=
    ids.length>1
     ?'АЗС, где можно выполнить всю выбранную потребность в топливе, не найдены.'
     :'Подходящих вариантов нет.';

   return;
  }

  const note=
   document.createElement(
    'div'
   );

  note.className=
   'best-list-note';

  note.textContent=
   'Экономия и переплата по каждому виду топлива рассчитаны относительно ближайшей подходящей АЗС для этого топлива.';

  bestList.append(note);

  renderNearestStation(
   nearest,
   bases,
   ids
  );

  if(
   alternatives.length
  ){
   const title=
    document.createElement(
     'div'
    );

   title.className=
    'best-alternatives-title';

   title.textContent=
    'Более выгодные АЗС:';

   bestList.append(title);

   alternatives.forEach(x=>
    renderAlternativeStation(
     x,
     bases,
     ids
    )
   );

  }else{
   const empty=
    document.createElement(
     'div'
    );

   empty.className=
    'best-empty';

   empty.textContent=
    'Более выгодных подходящих АЗС не найдено.';

   bestList.append(empty);
  }

 }catch(e){
  if(
   e.code==='NETWORK_ERROR'
  ){
   bestMessage.textContent=
    'Не удалось получить данные АЗС из-за проблем со связью.';

   showError(
    openBestStations
   );

  }else{
   bestMessage.textContent=
    'Не удалось подобрать выгодные АЗС.';
  }
 }
}

function hideAlternative(){
 bestAlternative.hidden=true;
 bestAlternative.innerHTML='';
}

async function loadAlternative(){
 const currentId=
  station?.station?.id;

 hideAlternative();

 if(!currentId){
  return;
 }

 /*
  ВАЖНО:
  фиксируем набор топлив и выбранную АЗС ДО любых await.
  Больше не используем изменяемый stationDetails при отрисовке результата.
 */
 const ids=
  [...remainingFuelIds()];

 const selectedBaseDetails=
  stationDetails;

 try{
  await ensureStationData();

  const alternatives=
   new Map();

  for(const id of ids){
   if(
    !Object.hasOwn(
     selectedBaseDetails.prices,
     id
    )
   ){
    continue;
   }

   const currentPrice=
    Number(
     selectedBaseDetails.prices[id]
    );

   const candidates=
    await fuelCandidates(id);

   candidates.forEach(x=>{
    if(
     x.station.id===
     currentId
    ){
     return;
    }

    /*
     АЗС попадает в "Можно выгоднее",
     если она выгоднее хотя бы по одному из выбранных топлив.
    */
    if(
     x.fuel.price>=
     currentPrice
    ){
     return;
    }

    if(
     !alternatives.has(
      x.station.id
     )
    ){
     alternatives.set(
      x.station.id,
      {
       station:x.station,
       details:x.details,
       distance:x.distance,
       direction:x.direction
      }
     );
    }
   });
  }

  /*
   Пользователь мог за время запросов уйти на другую АЗС.
  */
  if(
   station?.station?.id!==
   currentId
  ){
   return;
  }

  const groups=
   [...alternatives.values()]
    .sort(
     (a,b)=>
      a.distance-
      b.distance
    );

  if(!groups.length){
   return;
  }

  bestAlternative.innerHTML=
   `<div class="best-alternative-title">Можно выгоднее</div>
    <div class="best-alternative-note">Экономия относительно выбранной АЗС.</div>
    <div class="alternative-list"></div>`;

  const list=
   bestAlternative
    .querySelector(
     '.alternative-list'
    );

  groups.forEach(x=>{
   const b=
    document.createElement(
     'button'
    );

   const dir=
    dirText(
     x.direction
    );

   b.className=
    'alternative-card';

   b.innerHTML=
    `<div class="alternative-head">
      <div class="alternative-head-main">
       <div class="alternative-name">
        ${x.station.name}
       </div>

       <div class="station-info">
        <span class="station-distance">
         ${x.distance.toFixed(1)} км по прямой
        </span>

        ${dir
          ?`<span class="station-direction">${dir}</span>`
          :''
        }
       </div>
      </div>

      <div class="alternative-head-address">
       ${x.station.address}
      </div>
     </div>`;

   /*
    Здесь ОБЯЗАТЕЛЬНО передаются все ids,
    а база сравнения — зафиксированная selectedBaseDetails.
   */
   renderFuelRows(
    b,
    x,
    new Map(),
    ids,
    'selected',
    selectedBaseDetails
   );

   b.onclick=()=>
    openStation(
     x,
     stationReturn
    );

   list.append(b);
  });

  bestAlternative.hidden=false;

 }catch(e){
  if(
   e.code==='NETWORK_ERROR'
  ){
   showError(
    loadAlternative
   );
  }
 }
}

function renderStation(){
 const d=
  stationDetails;

 const s=
  station.station;

 const dir=
  dirText(
   stationDirection(s)
  );

 stationMain.innerHTML=
  `<div class="station-detail-name">${s.name}</div>
   <div class="station-detail-address">${s.address}</div>

   <div class="station-detail-meta">
    <span class="station-distance">${station.distance.toFixed(1)} км по прямой</span>
    ${dir?`<span class="station-direction">${dir}</span>`:''}
   </div>`;

 stationLimit.innerHTML=
  `<div class="muted">На этой АЗС ограничение по объёму одного заказа:</div>
   <div class="station-limit-value">${d.litersMin}–${d.litersMax} л</div>
   <div class="station-limit-note">Если топлива требуется больше, оформите его несколькими заказами.</div>`;

 const fs=
  remainingFuelIds()
   .map(
    id=>
     fuelState(d,id)
   );

 detailFuels.innerHTML='';

 fs.forEach(f=>{
  const c=
   document.createElement(
    'div'
   );

  c.className=
   'detail-fuel-card'+
   (
    !f.available
     ?' unavailable'
     :''
   );

  const p=
   f.available
    ?orderPlan(
      f.volume,
      d.litersMin,
      d.litersMax
     )
    :null;

  c.innerHTML=
   `<div class="detail-fuel-top">
     <div class="detail-fuel-name">${f.stationLabel}</div>
     ${f.price!=null?`<div class="detail-fuel-price">${price(f.price)}</div>`:''}
    </div>

    <div class="detail-fuel-meta">
     <div class="detail-fuel-volume">Нужно: ${f.volume} л</div>
     ${p?.possible?`<div class="order-count-badge">Потребуется ${p.orders} ${orderWord(p.orders)}</div>`:''}
    </div>`;

  if(!f.available){
   c.innerHTML+=
    `<div class="detail-message warning">${
     f.status==='missing'
      ?'Этого вида топлива на выбранной АЗС нет.'
      :'Колонки с этим топливом сейчас недоступны.'
    }</div>`;

  }else{
   if(!p.possible){
    c.innerHTML+=
     `<div class="detail-message warning">${
      p.reason==='below-min'
       ?`Объём ниже минимального заказа на этой АЗС - ${d.litersMin} л.`
       :`Этот объём нельзя распределить по заказам от ${d.litersMin} до ${d.litersMax} л.`
     }</div>`;
   }

   if(
    !p.possible&&
    p.reason==='below-min'
   ){
    let draftVolume=
     d.litersMin;

    const editor=
     document.createElement(
      'div'
     );

    const wheel=
     document.createElement(
      'div'
     );

    const saveButton=
     document.createElement(
      'button'
     );

    editor.className=
     'order-volume-editor visible';

    saveButton.className=
     'order-volume-save';

    saveButton.textContent=
     'Сохранить';

    editor.append(
     wheel,
     saveButton
    );

    c.append(editor);

    buildWheel(
     wheel,
     draftVolume,
     v=>{
      draftVolume=v;
     },
     d.litersMin,
     d.litersMax
    );

    saveButton.onclick=()=>{
     planned[f.id]=
      roundLiters(
       draftVolume
      );

     orderLiters=null;
     selectedPump=null;
     pendingRequest=null;

     renderStation();

     save('station');

     loadAlternative();
    };
   }

   const b=
    document.createElement(
     'button'
    );

   b.className=
    'fuel-order-btn';

   b.textContent=
    `Заказать ${f.stationLabel}`;

   b.disabled=
    !p.possible;

   b.onclick=()=>
    openOrder(f.id);

   c.append(b);
  }

  detailFuels.append(c);
 });

 const good=
  fs.filter(
   f=>
    f.available&&
    orderPlan(
     f.volume,
     d.litersMin,
     d.litersMax
    ).possible
  );

 const sum=
  good.reduce(
   (a,f)=>
    a+
    f.price*
    f.volume,
   0
  );

 stationSummary.innerHTML=
  '<div class="summary-title">Планируемая заправка</div>';

 good.forEach(f=>{
  stationSummary.innerHTML+=
   `<div class="summary-row">
     <span>${f.stationLabel} - ${f.volume} л</span>
     <strong>${money(f.price*f.volume)}</strong>
    </div>`;
 });

 if(good.length>1){
  stationSummary.innerHTML+=
   `<div class="summary-row summary-total">
     <span>Итого</span>
     <strong>${money(sum)}</strong>
    </div>`;
 }

 stationSummary.innerHTML+=
  `<div class="summary-row summary-limit">
    <span>Доступный лимит рейса</span>
    <strong>${money(trip.limitLeft)}</strong>
   </div>`;

 if(
  sum>trip.limitLeft
 ){
  stationSummary.innerHTML+=
   `<div class="limit-warning">
    Для указанного объёма топлива текущего остатка лимита рейса недостаточно.
   </div>`;
 }
}

async function stationContext(id){
 const[
  t,
  l,
  d
 ]=
  await Promise.all([
   readApi(
    ()=>FakeApi.getTrip()
   ),
   readApi(
    ()=>FakeApi.getDriverLocation()
   ),
   readApi(
    ()=>FakeApi.getStation(id)
   )
  ]);

 trip=t;
 driverLocation=l;
 stationDetails=d;

 rememberLocation(l);

 showTrip();

 cache.set(
  id,
  d
 );

 station={
  station:d,

  distance:
   distance(
    l.lat,
    l.lon,
    d.lat,
    d.lon
   ),

  direction:
   stationDirection(d)
 };
}

async function openStation(
 x,
 returnTo='stations'
){
 stopLocation();
 stopFueling();
 hideError();

 stationReturn=
  returnTo;

 try{
  await stationContext(
   x.station.id
  );

  orderFuelId=null;
  orderLiters=null;
  selectedPump=null;
  pendingRequest=null;
  activeFueling=null;
  orderNotice='';

  hideAlternative();
  renderStation();

  showPage('station');
  save('station');

  loadAlternative();

 }catch(e){
  if(
   e.code==='NETWORK_ERROR'
  ){
   showError(
    ()=>
     openStation(
      x,
      returnTo
     )
   );
  }
 }
}

function currentOrder(){
 const f=
  fuelState(
   stationDetails,
   orderFuelId
  );

 const defaultLiters=
  firstOrder(
   f.volume,
   stationDetails.litersMin,
   stationDetails.litersMax
  );

 let liters=
  orderLiters;

 if(
  liters==null||
  liters<
   stationDetails.litersMin||
  liters>
   stationDetails.litersMax
 ){
  liters=
   defaultLiters;
 }

 return{
  fuel:f,
  liters,

  cost:
   liters==null
    ?null
    :liters*f.price
 };
}

function addPlanHint(
 liters,
 cost
){
 const actualLiters=
  Number(
   liters||0
  );

 const actualCost=
  Number(
   cost||0
  );

 const left=
  Math.max(
   0,
   trip.limitLeft-
   actualCost
  );

 const rest=
  selectedFuels
   .map(id=>{
    const vol=
     Math.max(
      0,
      roundLiters(
       planned[id]
      )-
      (
       id===orderFuelId
        ?actualLiters
        :0
      )
     );

    if(!vol){
     return null;
    }

    const p=
     stationDetails
      .prices[id];

    return{
     label:
      stationFuelName(
       stationDetails,
       id
      ),

     volume:
      vol,

     price:
      Number.isFinite(p)
       ?p
       :null
    };
   })
   .filter(Boolean);

 if(!rest.length){
  return;
 }

 const known=
  rest.filter(
   x=>x.price!=null
  );

 const sum=
  known.reduce(
   (a,x)=>
    a+
    x.volume*
    x.price,
   0
  );

 const all=
  known.length===
  rest.length;

 const text=
  rest
   .map(
    x=>
     `${x.label} - ${x.volume} л`
   )
   .join(', ');

 const n=
  document.createElement(
   'div'
  );

 n.className=
  all&&sum>left
   ?'order-note problem'
   :'order-note warning';

 n.textContent=
  all&&sum>left
   ?`После этого заказа останется ${money(left)}. На оставшиеся ${text} по текущим ценам потребуется около ${money(sum)}. Лимита не хватит на ${money(sum-left)}.`
   :all
    ?`После этого заказа останется ${money(left)}. В плане ещё: ${text}. По текущим ценам средств достаточно.`
    :`После этого заказа останется ${money(left)}. В плане ещё: ${text}.`;

 orderFuel.append(n);
}

function fuelingText(f){
 if(
  f.status==='accepted'
 ){
  return'Заказ принят АЗС. Ожидаем готовность колонки.';
 }

 if(
  f.status==='waiting_nozzle'
 ){
  return'Заказ активен. Вставьте пистолет в бак в течение 60 секунд. Ожидайте.';
 }

 if(
  f.status==='fueling'
 ){
  return`Идёт заправка: ${f.currentLiters} из ${f.liters} л.`;
 }

 return'';
}

function cancelText(f){
 const reason=
  f.reason||
  f.cancelReason;

 if(
  reason==='PUMP_TIMEOUT'
 ){
  return'Заправка отменена: пистолет не был вставлен в бак в течение 60 секунд. Удержание возвращено в лимит. Выберите свободную колонку и оформите заказ заново.';
 }

 if(
  reason==='STATION_NO_RESPONSE'
 ){
  return'АЗС не подтвердила заказ. Удержание возвращено в лимит. Попробуйте оформить заказ повторно или выберите другую АЗС.';
 }

 if(
  reason==='DRIVER_CANCELLED'
 ){
  return'Заказ отменён. Удержание возвращено в лимит. При необходимости оформите новый заказ.';
 }

 return'Заправка отменена. Удержание возвращено в лимит. Проверьте параметры заказа и попробуйте оформить его повторно.';
}

function renderOrder(){
 const pre=
  currentOrder();

 const f=
  pre.fuel;

 const valid=
  pre.liters!=null;

 const liters=
  activeFueling?.liters??
  (
   valid
    ?pre.liters
    :f.volume
  );

 const cost=
  activeFueling?.amountHeld??
  (
   valid
    ?pre.cost
    :null
  );

 const p=
  orderPlan(
   f.volume,
   stationDetails.litersMin,
   stationDetails.litersMax
  );

 orderStation.innerHTML=
  `<div class="order-station">${station.station.name}</div>
   <div class="order-address">${station.station.address}</div>`;

 orderFuel.innerHTML=
  `<div class="order-fuel">${activeFueling?.fuelName||f.stationLabel}</div>

   <div class="order-row">
    <span>Всего требуется</span>
    <strong>${f.volume} л</strong>
   </div>

   <div class="order-row">
    <span>Цена</span>
    <strong>${price(activeFueling?.price??f.price)}</strong>
   </div>

   <div class="order-row">
    <span>Текущий заказ</span>
    <strong>${liters} л</strong>
   </div>

   <div class="order-row">
    <span>Стоимость заказа</span>
    <strong>${cost==null?'—':money(cost)}</strong>
   </div>

   <div class="order-row">
    <span>Доступный лимит</span>
    <strong>${money(trip.limitLeft)}</strong>
   </div>`;

 if(
  !activeFueling&&
  !p.possible
 ){
  orderFuel.innerHTML+=
   `<div class="order-note warning">${
    p.reason==='below-min'
     ?`Указанный объём ${f.volume} л ниже минимального объёма одного заказа на этой АЗС - ${stationDetails.litersMin} л. Увеличьте объём минимум до ${stationDetails.litersMin} л.`
     :`Указанный объём нельзя распределить по заказам в пределах ${stationDetails.litersMin}–${stationDetails.litersMax} л.`
   }</div>`;

  addPlanHint(
   0,
   0
  );

 }else{
  if(
   !activeFueling&&
   liters<f.volume
  ){
   orderFuel.innerHTML+=
    `<div class="order-note">
     В текущем заказе ${liters} л. После него останется заправить ${f.volume-liters} л.
    </div>`;
  }

  if(
   !activeFueling&&
   cost>trip.limitLeft
  ){
   orderFuel.innerHTML+=
    `<div class="order-note problem">
     Стоимость текущего заказа превышает доступный лимит рейса.
    </div>`;
  }else if(
   !activeFueling
  ){
   addPlanHint(
    liters,
    cost
   );
  }
 }

 if(orderNotice){
  orderFuel.innerHTML+=
   `<div class="order-note problem">${orderNotice.text}</div>`;
 }

 fuelingStatus.hidden=
  !activeFueling;

 fuelingStatus.textContent=
  activeFueling
   ?fuelingText(activeFueling)
   :'';

 pumpTitle.hidden=
  !!activeFueling;

 orderPumps.innerHTML='';

 if(!activeFueling){
  f.pumps
   .filter(
    x=>x.status!=='off'
   )
   .forEach(pump=>{
    const b=
     document.createElement(
      'button'
     );

    b.className=
     'pump-btn'+
     (
      selectedPump===
      pump.number
       ?' selected'
       :''
     );

    b.disabled=
     pump.status!=='free'||
     orderSending;

    b.innerHTML=
     `Колонка ${pump.number}
      <span class="pump-status">${
       pump.status==='free'
        ?'Свободна'
        :'Занята'
      }</span>`;

    b.onclick=()=>{
     selectedPump=
      pump.number;

     pendingRequest=null;
     orderNotice='';

     renderOrder();
     save('order');
    };

    orderPumps.append(b);
   });
 }

 orderChangeVolume.disabled=
  !!activeFueling||
  orderSending;

 if(activeFueling){
  orderSubmit.disabled=
   statusChecking;

  orderSubmit.textContent=
   statusChecking
    ?'Проверяем статус...'
    :'Проверить статус';

 }else{
  orderSubmit.disabled=
   orderSending||
   selectedPump==null||
   !p.possible||
   cost>trip.limitLeft;

  orderSubmit.textContent=
   orderSending
    ?'Заказ отправлен - ожидайте'
    :'Заказать';
 }

 orderBack.disabled=
  !!activeFueling||
  orderSending;
}

async function openOrder(id){
 if(
  !station||
  roundLiters(
   planned[id]
  )<=0
 ){
  return;
 }

 stopLocation();
 stopFueling();
 hideError();

 try{
  await stationContext(
   station.station.id
  );

  orderFuelId=id;

  const f=
   fuelState(
    stationDetails,
    id
   );

  orderLiters=
   firstOrder(
    f.volume,
    stationDetails.litersMin,
    stationDetails.litersMax
   );

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
  if(
   e.code==='NETWORK_ERROR'
  ){
   showError(
    ()=>openOrder(id)
   );
  }
 }
}

function stopFueling(){
 if(fuelingTimer){
  clearTimeout(
   fuelingTimer
  );
 }

 fuelingTimer=null;
}

function scheduleFuelingPoll(
 delay=FUELING_INTERVAL
){
 stopFueling();

 if(activeFueling?.id){
  fuelingTimer=
   setTimeout(
    ()=>pollFueling(false),
    delay
   );
 }
}

async function refreshTrip(){
 trip=
  await readApi(
   ()=>FakeApi.getTrip()
  );

 showTrip();
}

function showResult(f){
 lastResult={
  fuelingId:
   f.id,

  stationId:
   f.stationId,

  fuel:
   f.fuel,

  factLiters:
   Number(
    f.factLiters||0
   ),

  factAmount:
   Number(
    f.factAmount||0
   ),

  limitLeft:
   trip.limitLeft
 };

 resultLiters.textContent=
  `${lastResult.factLiters} л`;

 resultAmount.textContent=
  money(
   lastResult.factAmount
  );

 resultLimit.textContent=
  money(
   lastResult.limitLeft
  );

 resultAction.textContent=
  remainingFuelIds().length
   ?'Продолжить заправку'
   :'Вернуться на главную страницу';

 resultAction.disabled=false;

 showPage('result');

 save(
  'result',
  {
   activeFuelingId:null
  }
 );
}

async function settle(f){
 stopFueling();

 statusChecking=false;

 const cancelledLiters=
  roundLiters(
   f.liters||
   orderLiters
  );

 if(
  !processed.has(
   f.id
  )
 ){
  if(
   f.status==='completed'
  ){
   planned[f.fuel]=
    roundLiters(
     roundLiters(
      planned[f.fuel]
     )-
     Number(
      f.factLiters||0
     )
    );
  }

  processed.add(
   f.id
  );
 }

 try{
  await refreshTrip();

 }catch(e){
  if(
   e.code!==
   'NETWORK_ERROR'
  ){
   throw e;
  }
 }

 activeFueling=null;
 pendingRequest=null;
 selectedPump=null;
 orderSending=false;

 if(
  f.status==='completed'
 ){
  orderLiters=null;

  showResult(f);

  return;
 }

 orderLiters=
  cancelledLiters;

 try{
  stationDetails=
   await readApi(
    ()=>FakeApi.getStation(
     station.station.id
    )
   );

  cache.set(
   stationDetails.id,
   stationDetails
  );

 }catch{}

 orderNotice={
  type:'warning',
  text:cancelText(f)
 };

 renderOrder();

 save(
  'order',
  {
   activeFuelingId:null
  }
 );
}

async function pollFueling(
 manual=false
){
 if(
  !activeFueling?.id||
  statusChecking
 ){
  return;
 }

 stopFueling();

 statusChecking=true;

 if(manual){
  renderOrder();
 }

 try{
  const f=
   await readApi(
    ()=>FakeApi.getFueling(
     activeFueling.id
    )
   );

  activeFueling=f;
  statusChecking=false;

  if(
   f.status==='completed'||
   f.status==='cancelled'
  ){
   await settle(f);

   return;
  }

  renderOrder();
  save('order');

  scheduleFuelingPoll();

 }catch(e){
  statusChecking=false;

  renderOrder();

  if(
   e.code==='NETWORK_ERROR'
  ){
   showError(
    async()=>
     pollFueling(true)
   );

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

function requestId(){
 return globalThis.crypto&&
  typeof crypto.randomUUID===
   'function'
   ?crypto.randomUUID()
   :'fuel_'+
    Date.now()+
    '_'+
    Math.random()
     .toString(16)
     .slice(2);
}

async function refreshOrderStation(){
 try{
  stationDetails=
   await readApi(
    ()=>FakeApi.getStation(
     station.station.id
    )
   );

  cache.set(
   stationDetails.id,
   stationDetails
  );

 }catch{}
}

function priceChanged(
 a,
 b
){
 return Number.isFinite(
  Number(a)
 )&&
 Number.isFinite(
  Number(b)
 )&&
 Math.round(
  Number(a)*100
 )!==
 Math.round(
  Number(b)*100
 );
}

async function submitOrder(){
 if(
  activeFueling||
  orderSending||
  selectedPump==null
 ){
  return;
 }

 const{
  fuel,
  liters,
  cost
 }=
  currentOrder();

 if(
  liters==null||
  cost>trip.limitLeft
 ){
  return;
 }

 const key=[
  station.station.id,
  orderFuelId,
  selectedPump,
  liters,
  fuel.price
 ].join('|');

 if(
  !pendingRequest||
  pendingRequest.key!==key
 ){
  pendingRequest={
   key,

   id:
    requestId(),

   payload:{
    stationId:
     station.station.id,

    pump:
     selectedPump,

    fuel:
     orderFuelId,

    liters,

    price:
     fuel.price
   }
  };
 }

 orderSending=true;
 orderNotice='';

 renderOrder();
 save('order');

 try{
  const f=
   await FakeApi
    .startFueling({
     ...pendingRequest.payload,

     clientRequestId:
      pendingRequest.id
    });

  await registerFueling(f);

 }catch(e){
  orderSending=false;

  if(
   e.code==='NETWORK_ERROR'
  ){
   renderOrder();
   save('order');

   showError(
    submitOrder
   );

   return;
  }

  const oldPrice=
   pendingRequest
    ?.payload
    ?.price;

  const failedPump=
   pendingRequest
    ?.payload
    ?.pump;

  await refreshOrderStation();

  const newPrice=
   stationDetails
    ?.prices
    ?.[orderFuelId];

  if(
   e.code==='PUMP_BUSY'
  ){
   const pump=
    stationDetails
     ?.pumps
     ?.find(
      p=>
       p.number===
       failedPump
     );

   if(pump){
    pump.status='busy';
   }

   selectedPump=null;
   pendingRequest=null;

   orderNotice={
    type:'warning',
    text:'Выбранная колонка уже занята. Выберите другую свободную колонку.'
   };

  }else if(
   priceChanged(
    oldPrice,
    newPrice
   )
  ){
   selectedPump=null;
   pendingRequest=null;

   orderNotice={
    type:'warning',
    text:`Цена изменилась: было ${price(oldPrice)}, стало ${price(newPrice)}. Проверьте новую сумму и подтвердите заказ ещё раз.`
   };

  }else if(
   e.code===
   'PRICE_CHANGED'
  ){
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

    text:
     e.message||
     'Заказ не создан. Проверьте параметры и попробуйте ещё раз.'
   };
  }

  renderOrder();
  save('order');
 }
}

async function restoreKnownFueling(id){
 if(!id){
  return false;
 }

 let f;

 try{
  f=
   await readApi(
    ()=>FakeApi.getFueling(id)
   );

 }catch(e){
  if(
   e.code==='NOT_FOUND'
  ){
   return false;
  }

  throw e;
 }

 orderFuelId=
  f.fuel;

 orderLiters=
  f.liters;

 if(
  !selectedFuels.includes(
   f.fuel
  )
 ){
  selectedFuels.push(
   f.fuel
  );
 }

 if(
  !planned[f.fuel]
 ){
  planned[f.fuel]=
   roundLiters(
    f.liters
   );
 }

 await stationContext(
  f.stationId
 );

 activeFueling=f;
 selectedPump=f.pump;
 orderSending=false;
 statusChecking=false;
 orderNotice='';

 if(
  f.status==='completed'||
  f.status==='cancelled'
 ){
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
 const s=
  saved();

 selectedFuels=
  loadFuels();

 if(s?.planned){
  planned={};

  Object.entries(
   s.planned
  ).forEach(
   ([id,v])=>{
    planned[id]=
     roundLiters(v);
   }
  );
 }

 if(s?.processed){
  processed=
   new Set(
    s.processed
   );
 }

 if(s?.lastResult){
  lastResult=
   s.lastResult;
 }

 if(s?.pendingRequest){
  pendingRequest=
   s.pendingRequest;
 }

 if(
  s?.orderLiters!=null
 ){
  orderLiters=
   roundLiters(
    s.orderLiters
   );
 }

 if(s?.stationReturn){
  stationReturn=
   s.stationReturn;
 }

 const active=
  await readApi(
   ()=>FakeApi.getActiveFueling()
  );

 if(active){
  orderFuelId=
   active.fuel;

  orderLiters=
   active.liters;

  if(
   !selectedFuels.includes(
    active.fuel
   )
  ){
   selectedFuels.push(
    active.fuel
   );
  }

  if(
   !planned[
    active.fuel
   ]
  ){
   planned[
    active.fuel
   ]=
    roundLiters(
     active.liters
    );
  }

  await stationContext(
   active.stationId
  );

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

 if(
  s?.activeFuelingId&&
  await restoreKnownFueling(
   s.activeFuelingId
  )
 ){
  return;
 }

 if(
  s?.screen==='result'&&
  lastResult
 ){
  await refreshTrip();

  resultLiters.textContent=
   `${lastResult.factLiters} л`;

  resultAmount.textContent=
   money(
    lastResult.factAmount
   );

  resultLimit.textContent=
   money(
    trip.limitLeft
   );

  resultAction.textContent=
   remainingFuelIds().length
    ?'Продолжить заправку'
    :'Вернуться на главную страницу';

  showPage('result');

  return;
 }

 if(!s){
  return;
 }

 if(
  s.screen==='fuel'
 ){
  openFuel('main');
  return;
 }

 if(
  s.screen==='volume'
 ){
  openVolume('main');
  return;
 }

 if(
  s.screen==='stations'
 ){
  await openStations(
   s.searchQuery||''
  );

  return;
 }

 if(
  s.screen==='best'
 ){
  await openBestStations();

  return;
 }

 if(
  (
   s.screen==='station'||
   s.screen==='order'
  )&&
  s.stationId
 ){
  await stationContext(
   s.stationId
  );

  if(
   s.screen==='order'&&
   s.orderFuelId&&
   roundLiters(
    planned[
     s.orderFuelId
    ]
   )>0
  ){
   orderFuelId=
    s.orderFuelId;

   selectedPump=null;
   orderSending=false;
   statusChecking=false;
   orderNotice='';

   renderOrder();
   showPage('order');
   save('order');

  }else{
   orderLiters=null;

   hideAlternative();
   renderStation();
   showPage('station');
   save('station');

   loadAlternative();
  }
 }
}

$('start-fueling-btn').onclick=
 startFlow;

fuelContinue.onclick=()=>{
 selectedFuels=
  FUELS
   .filter(
    ([id])=>
     draftFuels.has(id)
   )
   .map(
    ([id])=>id
   );

 Object.keys(
  planned
 ).forEach(id=>{
  if(
   !selectedFuels.includes(id)
  ){
   delete planned[id];
  }
 });

 saveFuels();
 renderSelectedFuels();

 openVolume(
  fuelReturn==='stations'
   ?'stations'
   :'main'
 );
};

$('fuel-back-btn').onclick=()=>{
 if(
  fuelReturn==='stations'
 ){
  showPage('stations');

  startLocation();

  save('stations');

 }else if(
  fuelReturn==='volume'
 ){
  showPage('volume');

  renderVolumes();

  save('volume');

 }else{
  hidePages();
  clearSaved();
 }
};

$('volume-change-fuels-btn').onclick=
 ()=>openFuel('volume');

volumeContinue.onclick=async()=>{
 if(
  !volumeContinue.disabled
 ){
  await openStations();
 }
};

$('volume-back-btn').onclick=()=>{
 if(
  volumeReturn==='stations'
 ){
  showPage('stations');

  startLocation();

  save('stations');

 }else{
  hidePages();
  clearSaved();
 }
};

$('change-fuel-btn').onclick=
 ()=>openFuel('stations');

bestStationBtn.onclick=
 openBestStations;

stationSearch.oninput=
 searchStations;

$('back-btn').onclick=()=>{
 stopLocation();
 clearSaved();
 hidePages();
};

$('best-back-btn').onclick=()=>{
 showPage('stations');
 startLocation();
 save('stations');
};

$('station-back-btn').onclick=()=>{
 hideAlternative();

 if(
  stationReturn==='best'
 ){
  openBestStations();

 }else{
  showPage('stations');
  startLocation();
  save('stations');
 }
};

orderBack.onclick=()=>{
 if(
  activeFueling||
  orderSending
 ){
  return;
 }

 orderLiters=null;

 orderVolumeEditor
  .classList
  .remove('visible');

 orderChangeVolume.hidden=false;

 showPage('station');

 renderStation();

 save('station');

 loadAlternative();
};

orderChangeVolume.onclick=()=>{
 if(
  activeFueling||
  orderSending
 ){
  return;
 }

 const current=
  currentOrder();

 if(
  current.liters==null
 ){
  return;
 }

 orderDraftVolume=
  current.liters;

 orderChangeVolume.hidden=true;

 orderVolumeEditor
  .classList
  .add('visible');

 buildWheel(
  orderVolumeWheel,
  orderDraftVolume,
  v=>orderDraftVolume=v,
  stationDetails.litersMin,
  stationDetails.litersMax
 );
};

$('order-volume-save').onclick=()=>{
 if(
  activeFueling||
  orderSending||
  !(orderDraftVolume>0)
 ){
  return;
 }

 orderLiters=
  roundLiters(
   orderDraftVolume
  );

 if(
  orderLiters>
  roundLiters(
   planned[
    orderFuelId
   ]
  )
 ){
  planned[
   orderFuelId
  ]=
   orderLiters;
 }

 selectedPump=null;
 pendingRequest=null;
 orderNotice='';

 orderVolumeEditor
  .classList
  .remove('visible');

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
 if(
  resultAction.disabled
 ){
  return;
 }

 const destination=
  lastResult?.stationId||
  station?.station?.id||
  saved()?.stationId;

 if(
  remainingFuelIds().length
 ){
  resultAction.disabled=true;

  resultAction.textContent=
   'Обновляем данные...';

  try{
   await stationContext(
    destination
   );

   lastResult=null;
   orderLiters=null;

   hideAlternative();
   renderStation();
   showPage('station');

   save(
    'station',
    {
     activeFuelingId:null
    }
   );

   loadAlternative();

  }catch(e){
   resultAction.disabled=false;

   resultAction.textContent=
    'Продолжить заправку';

   if(
    e.code==='NETWORK_ERROR'
   ){
    showError(
     resultAction.onclick
    );
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

   hideAlternative();

   clearSaved();
   hidePages();

  }catch(e){
   resultAction.disabled=false;

   resultAction.textContent=
    'Вернуться на главную страницу';

   if(
    e.code==='NETWORK_ERROR'
   ){
    showError(
     resultAction.onclick
    );
   }
  }
 }
};

async function init(){
 try{
  trip=
   await readApi(
    ()=>FakeApi.getTrip()
   );

  ensureMovement();

  showTrip();

  await restore();

  app.classList.remove(
   'restoring'
  );

 }catch(e){
  if(
   e.code==='NETWORK_ERROR'
  ){
   showError(init);

  }else{
   app.classList.remove(
    'restoring'
   );
  }
 }
}

init();