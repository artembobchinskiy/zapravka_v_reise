const tripDate = document.getElementById('trip-date');
const tripRoute = document.getElementById('trip-route');
const tripTruck = document.getElementById('trip-truck');

const limitLeft = document.getElementById('limit-left');
const limitTotal = document.getElementById('limit-total');
const limitProgressFill = document.getElementById('limit-progress-fill');


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

  tripRoute.textContent =
    `${trip.from} → ${trip.to}`;

  tripTruck.textContent =
    `Тягач ${trip.truck}`;

  limitLeft.textContent =
    formatMoney(trip.limitLeft);

  limitTotal.textContent =
    formatMoney(trip.limitTotal);

  const limitPercent =
    trip.limitTotal > 0
      ? (trip.limitLeft / trip.limitTotal) * 100
      : 0;

  limitProgressFill.style.width =
    `${Math.min(limitPercent, 100)}%`;
}


async function loadTrip() {
  try {
    const trip = await FakeApi.getTrip();

    showTrip(trip);
  } catch (error) {
    console.error(
      'Не удалось загрузить данные рейса:',
      error
    );
  }
}


loadTrip();