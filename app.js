const $ = (id) => document.getElementById(id);

const tripDate = $('trip-date');
const tripRoute = $('trip-route');
const tripTruck = $('trip-truck');
const limitLeft = $('limit-left');
const limitTotal = $('limit-total');
const limitProgressFill = $('limit-progress-fill');

const errorOverlay = $('error-overlay');
const errorMessage = $('error-message');
const retryButton = $('retry-btn');

const startFuelingButton = $('start-fueling-btn');

const fuelPage = $('fuel-page');
const fuelOptions = $('fuel-options');
const fuelContinueButton = $('fuel-continue-btn');
const fuelBackButton = $('fuel-back-btn');

const volumePage = $('volume-page');
const volumeInput = $('volume-input');
const volumeContinueButton = $('volume-continue-btn');
const volumeBackButton = $('volume-back-btn');

const stationsPage = $('stations-page');
const selectedFuelsElement = $('selected-fuels');
const changeFuelButton = $('change-fuel-btn');
const stationSearch = $('station-search');
const stationList = $('station-list');
const searchMessage = $('search-message');
const stationWarning = $('station-warning');
const backButton = $('back-btn');

const LOCATION_INTERVAL = 60 * 1000;
const DIRECTION_INTERVAL = 5 * 60 * 1000;
const MIN_MOVEMENT_DISTANCE = 0.5;
const DIRECTION_MAX_AGE = 10 * 60 * 1000;

const ROUTE_DEVIATION = 1.4;
const MIN_ROUTE_MARGIN = 50;
const MAX_BACKWARD_DISTANCE = 100;

const FUEL_TYPES = [
  ['diesel', 'Дизель'],
  ['diesel_premium', 'Премиальный дизель'],
  ['diesel_winter', 'Зимний дизель'],
  ['ai92', 'АИ-92'],
  ['ai95', 'АИ-95'],
  ['ai100', 'АИ-100'],
  ['propane', 'Пропан']
];

const CITY_COORDINATES = {
  'Москва': { lat: 55.75, lon: 37.62 },
  'Казань': { lat: 55.79, lon: 49.12 }
};

let currentTrip = null;
let stations = [];
let driverLocation = null;

let selectedStationId = null;
let selectedFuels = [];
let draftSelectedFuels = new Set();
let plannedVolume = 0;
let fuelPageReturn = 'main';

let retryAction = null;
let locationTimer = null;
let searchVersion = 0;
let stationDetailsCache = new Map();

let movementState = loadMovementState();


function formatMoney(value) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0
  }).format(value) + ' ₽';
}


function formatPrice(value) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value) + ' ₽/л';
}


function formatDate(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long'
  }).format(
    new Date(value + 'T00:00:00')
  );
}


function fuelLabel(id) {
  return FUEL_TYPES.find(
    (fuel) => fuel[0] === id
  )?.[1] || id;
}


function showTrip(trip) {
  tripDate.textContent =
    formatDate(trip.date);

  tripRoute.textContent =
    `${trip.from} → ${trip.to}`;

  tripTruck.textContent =
    `Тягач ${trip.truck}`;

  limitLeft.textContent =
    formatMoney(trip.limitLeft);

  limitTotal.textContent =
    formatMoney(trip.limitTotal);

  const percent =
    trip.limitTotal
      ? trip.limitLeft / trip.limitTotal * 100
      : 0;

  limitProgressFill.style.width =
    `${Math.min(percent, 100)}%`;
}


function showNetworkError(action) {
  retryAction = action;

  errorMessage.textContent =
    'Нет связи с сервером';

  errorOverlay.classList.add('visible');

  errorOverlay.setAttribute(
    'aria-hidden',
    'false'
  );
}


function hideNetworkError() {
  errorOverlay.classList.remove('visible');

  errorOverlay.setAttribute(
    'aria-hidden',
    'true'
  );
}


async function loadTrip() {
  hideNetworkError();

  try {
    currentTrip =
      await FakeApi.getTrip();

    ensureMovementStateForTrip();
    showTrip(currentTrip);

    return true;
  } catch (error) {
    if (error.code === 'NETWORK_ERROR') {
      showNetworkError(loadTrip);
    }

    return false;
  }
}


function fuelStorageKey() {
  return currentTrip
    ? `fuelSelection_${currentTrip.id}`
    : null;
}


function loadSelectedFuels() {
  const key = fuelStorageKey();

  if (!key) {
    return [];
  }

  try {
    const saved = JSON.parse(
      localStorage.getItem(key)
    );

    const valid =
      FUEL_TYPES.map(
        (fuel) => fuel[0]
      );

    return Array.isArray(saved)
      ? saved.filter(
          (id) => valid.includes(id)
        )
      : [];
  } catch {
    return [];
  }
}


function saveSelectedFuels() {
  const key = fuelStorageKey();

  if (key) {
    localStorage.setItem(
      key,
      JSON.stringify(selectedFuels)
    );
  }
}


function renderFuelOptions() {
  fuelOptions.innerHTML = '';

  FUEL_TYPES.forEach(([id, label]) => {
    const button =
      document.createElement('button');

    button.className = 'fuel-option';
    button.type = 'button';
    button.textContent = label;

    if (draftSelectedFuels.has(id)) {
      button.classList.add('selected');

      const check =
        document.createElement('span');

      check.className =
        'fuel-option-check';

      check.textContent = '✓';

      button.appendChild(check);
    }

    button.onclick = () => {
      if (draftSelectedFuels.has(id)) {
        draftSelectedFuels.delete(id);
      } else {
        draftSelectedFuels.add(id);
      }

      renderFuelOptions();
    };

    fuelOptions.appendChild(button);
  });

  fuelContinueButton.disabled =
    draftSelectedFuels.size === 0;
}


function renderSelectedFuelSummary() {
  selectedFuelsElement.textContent =
    selectedFuels
      .map(fuelLabel)
      .join(', ');
}


function openFuelPage(returnTo) {
  stopLocationTracking();

  fuelPageReturn = returnTo;

  draftSelectedFuels =
    new Set(selectedFuels);

  stationsPage.classList.remove('visible');
  volumePage.classList.remove('visible');
  fuelPage.classList.add('visible');

  renderFuelOptions();
}


function openVolumePage() {
  fuelPage.classList.remove('visible');
  volumePage.classList.add('visible');

  volumeInput.value = '';
  volumeContinueButton.disabled = true;

  volumeInput.focus();
}


async function continueAfterFuelSelection() {
  selectedFuels =
    FUEL_TYPES
      .filter(([id]) =>
        draftSelectedFuels.has(id)
      )
      .map(([id]) => id);

  saveSelectedFuels();
  renderSelectedFuelSummary();

  if (fuelPageReturn === 'stations') {
    await openStationsPage();
  } else {
    openVolumePage();
  }
}


function closeFuelPage() {
  fuelPage.classList.remove('visible');

  if (fuelPageReturn === 'stations') {
    stationsPage.classList.add('visible');
    startLocationTracking();
  }
}


async function startFuelingFlow() {
  hideNetworkError();

  try {
    currentTrip =
      await FakeApi.getTrip();

    ensureMovementStateForTrip();
    showTrip(currentTrip);

    selectedFuels =
      loadSelectedFuels();

    if (!selectedFuels.length) {
      openFuelPage('main');
    } else {
      renderSelectedFuelSummary();
      openVolumePage();
    }
  } catch (error) {
    if (error.code === 'NETWORK_ERROR') {
      showNetworkError(
        startFuelingFlow
      );
    }
  }
}


function emptyMovementState() {
  return {
    tripId: null,
    reference: null,
    latest: null,
    direction: null
  };
}


function loadMovementState() {
  try {
    return {
      ...emptyMovementState(),
      ...JSON.parse(
        localStorage.getItem(
          'driverMovementState'
        )
      )
    };
  } catch {
    return emptyMovementState();
  }
}


function ensureMovementStateForTrip() {
  if (
    !currentTrip ||
    movementState.tripId === currentTrip.id
  ) {
    return;
  }

  movementState =
    emptyMovementState();

  movementState.tripId =
    currentTrip.id;

  saveMovementState();
}


function saveMovementState() {
  localStorage.setItem(
    'driverMovementState',
    JSON.stringify(movementState)
  );
}


function saveLocation(location) {
  ensureMovementStateForTrip();

  const point = {
    lat: location.lat,
    lon: location.lon,
    timestamp: Date.now()
  };

  if (!movementState.reference) {
    movementState.reference = point;
    movementState.latest = point;

    saveMovementState();
    return;
  }

  movementState.latest = point;

  const elapsed =
    point.timestamp -
    movementState.reference.timestamp;

  if (elapsed >= DIRECTION_INTERVAL) {
    const distance = getDistance(
      movementState.reference.lat,
      movementState.reference.lon,
      point.lat,
      point.lon
    );

    if (
      distance >=
      MIN_MOVEMENT_DISTANCE
    ) {
      movementState.direction = {
        from: movementState.reference,
        to: point,
        confirmedAt: point.timestamp
      };
    } else {
      movementState.direction = null;
    }

    movementState.reference = point;
  }

  saveMovementState();
}


async function updateDriverLocation(showError) {
  try {
    driverLocation =
      await FakeApi.getDriverLocation();

    saveLocation(driverLocation);

    if (stationSearch.value.trim()) {
      searchStations();
    }

    return true;
  } catch (error) {
    if (
      showError &&
      error.code === 'NETWORK_ERROR'
    ) {
      showNetworkError(loadStations);
    }

    return false;
  }
}


async function loadStations() {
  hideNetworkError();

  if (!await updateDriverLocation(true)) {
    return false;
  }

  try {
    stations =
      await FakeApi.getStations();

    if (stationSearch.value.trim()) {
      searchStations();
    }

    return true;
  } catch (error) {
    if (error.code === 'NETWORK_ERROR') {
      showNetworkError(loadStations);
    }

    return false;
  }
}


function startLocationTracking() {
  stopLocationTracking();

  locationTimer = setInterval(
    () => updateDriverLocation(false),
    LOCATION_INTERVAL
  );
}


function stopLocationTracking() {
  if (locationTimer) {
    clearInterval(locationTimer);
    locationTimer = null;
  }
}


async function openStationsPage() {
  selectedStationId = null;

  stationDetailsCache = new Map();

  searchVersion += 1;

  renderSelectedFuelSummary();

  stationSearch.value = '';
  stationList.innerHTML = '';
  searchMessage.textContent = '';

  stationWarning.style.display =
    'none';

  fuelPage.classList.remove('visible');
  volumePage.classList.remove('visible');
  stationsPage.classList.add('visible');

  const loaded =
    await loadStations();

  if (loaded) {
    startLocationTracking();
    stationSearch.focus();
  }
}


async function closeStationsPage() {
  stopLocationTracking();

  searchVersion += 1;

  stationsPage.classList.remove('visible');

  await loadTrip();
}


function getDistance(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const radius = 6371;

  const lat1Rad =
    lat1 * Math.PI / 180;

  const lat2Rad =
    lat2 * Math.PI / 180;

  const latDiff =
    (lat2 - lat1) *
    Math.PI / 180;

  const lonDiff =
    (lon2 - lon1) *
    Math.PI / 180;

  const a =
    Math.sin(latDiff / 2) ** 2 +
    Math.cos(lat1Rad) *
    Math.cos(lat2Rad) *
    Math.sin(lonDiff / 2) ** 2;

  return radius * 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );
}


function getDirectionVector() {
  const direction =
    movementState.direction;

  if (
    !direction ||
    Date.now() -
      direction.confirmedAt >
      DIRECTION_MAX_AGE
  ) {
    return null;
  }

  return {
    from: direction.from,
    to: direction.to
  };
}


function getStationDirection(station) {
  const direction =
    getDirectionVector();

  if (
    !driverLocation ||
    !direction
  ) {
    return 'unknown';
  }

  const averageLat =
    (
      driverLocation.lat +
      station.lat
    ) / 2;

  const lonScale =
    Math.cos(
      averageLat *
      Math.PI / 180
    );

  const directionX =
    (
      direction.to.lon -
      direction.from.lon
    ) * lonScale;

  const directionY =
    direction.to.lat -
    direction.from.lat;

  const stationX =
    (
      station.lon -
      driverLocation.lon
    ) * lonScale;

  const stationY =
    station.lat -
    driverLocation.lat;

  return (
    directionX * stationX +
    directionY * stationY >= 0
  )
    ? 'forward'
    : 'backward';
}


function isStationInTripArea(station) {
  if (!currentTrip) {
    return true;
  }

  const from =
    CITY_COORDINATES[currentTrip.from];

  const to =
    CITY_COORDINATES[currentTrip.to];

  if (!from || !to) {
    return true;
  }

  const routeDistance =
    getDistance(
      from.lat,
      from.lon,
      to.lat,
      to.lon
    );

  const fromToStation =
    getDistance(
      from.lat,
      from.lon,
      station.lat,
      station.lon
    );

  const stationToDestination =
    getDistance(
      station.lat,
      station.lon,
      to.lat,
      to.lon
    );

  const allowed =
    Math.max(
      routeDistance *
        ROUTE_DEVIATION,
      routeDistance +
        MIN_ROUTE_MARGIN
    );

  return (
    fromToStation +
    stationToDestination <=
    allowed
  );
}


function stationHasAnySelectedFuel(
  station
) {
  return selectedFuels.some(
    (fuel) =>
      Object.hasOwn(
        station.prices,
        fuel
      )
  );
}


async function getStationDetails(id) {
  if (
    stationDetailsCache.has(id)
  ) {
    return stationDetailsCache.get(id);
  }

  try {
    const details =
      await FakeApi.getStation(id);

    stationDetailsCache.set(
      id,
      details
    );

    return details;
  } catch {
    return null;
  }
}


function availableSelectedFuels(
  details
) {
  return selectedFuels
    .filter((fuel) =>
      Object.hasOwn(
        details.prices,
        fuel
      )
    )
    .map((fuel) => {
      const pumps =
        details.pumps.filter(
          (pump) =>
            pump.fuels.includes(fuel)
        );

      const free =
        pumps.some(
          (pump) =>
            pump.status === 'free'
        );

      const busy =
        pumps.some(
          (pump) =>
            pump.status === 'busy'
        );

      if (!free && !busy) {
        return null;
      }

      return {
        id: fuel,
        label:
          fuelLabel(fuel),
        price:
          details.prices[fuel],
        free,
        busy
      };
    })
    .filter(Boolean);
}


async function prepareStation(station) {
  const distance =
    getDistance(
      driverLocation.lat,
      driverLocation.lon,
      station.lat,
      station.lon
    );

  const direction =
    getStationDirection(station);

  if (
    direction === 'backward' &&
    distance >
      MAX_BACKWARD_DISTANCE
  ) {
    return null;
  }

  const details =
    await getStationDetails(
      station.id
    );

  if (!details) {
    return null;
  }

  if (
    plannedVolume <
    details.litersMin
  ) {
    return null;
  }

  const fuels =
    availableSelectedFuels(
      details
    );

  if (!fuels.length) {
    return null;
  }

  return {
    station,
    distance,
    direction,
    fuels
  };
}


function preliminaryStations(query) {
  const words =
    query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  return stations
    .filter(
      stationHasAnySelectedFuel
    )
    .filter(
      isStationInTripArea
    )
    .filter((station) => {
      const text = (
        station.brand +
        ' ' +
        station.name +
        ' ' +
        station.address
      ).toLowerCase();

      return words.every(
        (word) =>
          text.includes(word)
      );
    });
}


function compareStations(a, b) {
  const direction =
    getDirectionVector();

  if (!direction) {
    return (
      a.distance -
      b.distance
    );
  }

  const order = {
    forward: 0,
    unknown: 1,
    backward: 2
  };

  return (
    order[a.direction] -
      order[b.direction] ||
    a.distance -
      b.distance
  );
}


function directionText(direction) {
  if (direction === 'forward') {
    return 'В направлении движения';
  }

  if (direction === 'backward') {
    return 'В обратном направлении';
  }

  return '';
}


function renderStationCard(item) {
  const station =
    item.station;

  const button =
    document.createElement(
      'button'
    );

  button.className =
    'station-item';

  button.type = 'button';

  if (
    station.id ===
    selectedStationId
  ) {
    button.classList.add(
      'selected'
    );
  }

  const name =
    document.createElement(
      'div'
    );

  name.className =
    'station-name';

  const nameText =
    document.createElement(
      'span'
    );

  nameText.textContent =
    station.name;

  name.appendChild(nameText);

  if (
    station.id ===
    selectedStationId
  ) {
    const check =
      document.createElement(
        'span'
      );

    check.className =
      'station-check';

    check.textContent = '✓';

    name.appendChild(check);
  }

  const info =
    document.createElement(
      'div'
    );

  info.className =
    'station-info';

  const distance =
    document.createElement(
      'span'
    );

  distance.className =
    'station-distance';

  distance.textContent =
    `${item.distance.toFixed(1)} км по прямой`;

  info.appendChild(distance);

  const directionLabel =
    directionText(
      item.direction
    );

  if (directionLabel) {
    const direction =
      document.createElement(
        'span'
      );

    direction.className =
      'station-direction';

    direction.textContent =
      directionLabel;

    info.appendChild(direction);
  }

  const fuels =
    document.createElement(
      'div'
    );

  fuels.className =
    'station-fuels';

  fuels.textContent =
    item.fuels
      .map(
        (fuel) =>
          `${fuel.label} ${formatPrice(fuel.price)}`
      )
      .join(', ');

  button.append(
    name,
    info,
    fuels
  );

  const hasFree =
    item.fuels.some(
      (fuel) => fuel.free
    );

  const hasBusyOnly =
    item.fuels.some(
      (fuel) =>
        !fuel.free &&
        fuel.busy
    );

  if (
    !hasFree ||
    hasBusyOnly
  ) {
    const note =
      document.createElement(
        'div'
      );

    note.className =
      'station-busy-note';

    note.textContent =
      !hasFree
        ? 'Подходящие колонки сейчас заняты'
        : 'Для части топлива свободных колонок сейчас нет';

    button.appendChild(note);
  }

  const address =
    document.createElement(
      'div'
    );

  address.className =
    'station-address';

  address.textContent =
    station.address;

  button.appendChild(address);

  button.onclick = () => {
    selectedStationId =
      station.id;

    searchStations();
  };

  stationList.appendChild(
    button
  );
}


async function searchStations() {
  const version =
    ++searchVersion;

  const query =
    stationSearch.value.trim();

  stationList.innerHTML = '';
  searchMessage.textContent = '';

  if (!query) {
    stationWarning.style.display =
      'none';

    return;
  }

  stationWarning.style.display =
    'block';

  searchMessage.textContent =
    'Проверяем доступность топлива...';

  const prepared =
    await Promise.all(
      preliminaryStations(query)
        .map(prepareStation)
    );

  if (
    version !==
    searchVersion
  ) {
    return;
  }

  const visible =
    prepared
      .filter(Boolean)
      .sort(compareStations);

  stationList.innerHTML = '';
  searchMessage.textContent = '';

  if (!visible.length) {
    searchMessage.textContent =
      'Подходящие АЗС не найдены.';

    return;
  }

  visible.forEach(
    renderStationCard
  );
}


retryButton.onclick = () => {
  if (retryAction) {
    retryAction();
  }
};


startFuelingButton.onclick =
  startFuelingFlow;


fuelContinueButton.onclick =
  continueAfterFuelSelection;


fuelBackButton.onclick =
  closeFuelPage;


volumeInput.oninput = () => {
  const value =
    Number(volumeInput.value);

  volumeContinueButton.disabled =
    !Number.isFinite(value) ||
    value <= 0;
};


volumeContinueButton.onclick =
  async () => {
    plannedVolume =
      Number(volumeInput.value);

    await openStationsPage();
  };


volumeBackButton.onclick = () => {
  volumePage.classList.remove(
    'visible'
  );

  volumeInput.value = '';

  volumeContinueButton.disabled =
    true;
};


changeFuelButton.onclick = () => {
  openFuelPage('stations');
};


stationSearch.oninput =
  searchStations;


backButton.onclick =
  closeStationsPage;


loadTrip();