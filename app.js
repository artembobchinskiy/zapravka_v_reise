const tripDate = document.getElementById('trip-date');
const tripRoute = document.getElementById('trip-route');
const tripTruck = document.getElementById('trip-truck');

const limitLeft = document.getElementById('limit-left');
const limitTotal = document.getElementById('limit-total');
const limitProgressFill = document.getElementById('limit-progress-fill');

const errorOverlay = document.getElementById('error-overlay');
const errorMessage = document.getElementById('error-message');
const retryButton = document.getElementById('retry-btn');


function formatMoney(value) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2
  }).format(value) + ' ₽';
}


function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long'
  }).format(date);
}


function showTrip(trip) {
  tripDate.textContent = formatDate(trip.date);
  tripRoute.textContent = `${trip.from} → ${trip.to}`;
  tripTruck.textContent = `Тягач ${trip.truck}`;

  limitLeft.textContent = formatMoney(trip.limitLeft);
  limitTotal.textContent = formatMoney(trip.limitTotal);

  const percent = trip.limitTotal > 0
    ? (trip.limitLeft / trip.limitTotal) * 100
    : 0;

  limitProgressFill.style.width = `${Math.min(percent, 100)}%`;
}


function showNetworkError() {
  errorMessage.textContent = 'Нет связи с сервером';
  errorOverlay.classList.add('visible');
  errorOverlay.setAttribute('aria-hidden', 'false');
}


function hideNetworkError() {
  errorOverlay.classList.remove('visible');
  errorOverlay.setAttribute('aria-hidden', 'true');
}


async function loadTrip() {
  hideNetworkError();

  try {
    const trip = await FakeApi.getTrip();
    showTrip(trip);
  } catch (error) {
    if (error.code === 'NETWORK_ERROR') {
      showNetworkError();
    }
  }
}


retryButton.addEventListener('click', loadTrip);

loadTrip();