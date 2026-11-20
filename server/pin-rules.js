// The one place that says what a PIN may be. Used by the POS (index.js, setup.js) and the cloud (cloud/index.js).
// A PIN is 4 to 12 letters or numbers. Capital and small letters count as the same (easier on a touch keyboard).
const ROLES = ['admin', 'cashier', 'kitchen', 'rider']; // 'admin' is shown as "Owner" on screen
const PIN_RULE = 'PIN must be 4 to 12 letters or numbers';
// The starting PINs of a new install: nobody keeps them. WEAK_PINS are also refused as chosen PINs.
const DEFAULT_PINS = ['1234', '1111', '2222', '3333'];
const WEAK_PINS = [...DEFAULT_PINS, '0000', '4321'];
const normPin = pin => String(pin ?? '').trim().toLowerCase();
const PIN_OK = pin => /^[a-z0-9]{4,12}$/.test(normPin(pin));
const isWeakPin = pin => WEAK_PINS.includes(normPin(pin));
module.exports = { ROLES, PIN_RULE, DEFAULT_PINS, WEAK_PINS, normPin, PIN_OK, isWeakPin };
