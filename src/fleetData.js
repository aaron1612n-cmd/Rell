// The ship registry: every hull you can buy at the yard or find adrift, with the numbers that fly it.
// Flight in fleet.js comes straight from these: acceleration = thrust / mass (propellant included, so a full
// tank is heavier), lateral RCS = rcs / mass, turn rate and angular acceleration are the attitude system's
// limits, propellant flow = thrust / (Isp * g0). Size (length, beam, height) is measured off the model.
//
// cat: 'yard' (buy at the shipyard by the depot), 'derelict' (find it adrift, board, then claim or sell it).
// A later hangar/merchant UI can read SHIPS and drive the same calls fleet.js exposes:
//   fleet.list() -> [{ ...spec, owned, found, sold, here }], fleet.buy(id), fleet.sell(id), fleet.claim(id), fleet.fly(id)

export const G0 = 9.80665;

export const SHIPS = [
  // ---- the yard -------------------------------------------------------------------------------------
  { id: 'wren', name: 'Wren', cls: 'Two-seat shuttle', cat: 'yard', maker: 'Halden Aerospace', built: 2209, crew: 1, berths: 2,
    dry: 11, prop: 4, cargo: 1.5, thrust: 210, isp: 380, rcs: 70, drive: '1 methalox main + 2 pod motors', reactor: 'Fuel cells, 60 kW',
    armor: 8, hull: 120, maxSpd: 120, turn: 70, angAcc: 140, sensors: 40, price: 6500,
    note: 'The yard runabout. Forgiving, cheap to run, short legs.' },
  { id: 'kite', name: 'Kite', cls: 'Fast courier', cat: 'yard', maker: 'Orrin-Vale', built: 2231, crew: 1, berths: 1,
    dry: 16, prop: 6, cargo: 2, thrust: 640, isp: 12000, rcs: 160, drive: '2 compact fusion torches', reactor: 'Mirror fusion, 40 MW',
    armor: 6, hull: 110, maxSpd: 210, turn: 95, angAcc: 260, sensors: 120, price: 18000,
    note: 'Three gees on a twitch. Built to carry mail and very little else.' },
  { id: 'hornet', name: 'Hornet', cls: 'Interceptor', cat: 'yard', maker: 'Kessler Arms', built: 2228, crew: 1, berths: 1,
    dry: 24, prop: 8, cargo: 0.5, thrust: 820, isp: 11000, rcs: 260, drive: '2 fusion torches, vectored', reactor: 'Mirror fusion, 55 MW',
    armor: 22, hull: 220, maxSpd: 190, turn: 120, angAcc: 320, sensors: 300, price: 26000,
    note: 'Ex-patrol. Turns faster than anything in the yard; the wingtip guns are long since pulled.' },
  { id: 'mule', name: 'Mule', cls: 'Deep-space tug', cat: 'yard', maker: 'Brannock Yards', built: 2196, crew: 3, berths: 4,
    dry: 280, prop: 120, cargo: 40, thrust: 6000, isp: 3200, rcs: 1100, drive: '4 fission-thermal bells', reactor: 'Fission pile, 900 MW',
    armor: 60, hull: 900, maxSpd: 80, turn: 28, angAcc: 30, sensors: 90, price: 34000,
    note: 'A push plate, two grapple arms and more thrust than sense. Moves wrecks for a living.' },
  { id: 'packhorse', name: 'Packhorse', cls: 'Light freighter', cat: 'yard', maker: 'Brannock Yards', built: 2215, crew: 4, berths: 6,
    dry: 900, prop: 300, cargo: 1200, thrust: 9600, isp: 9000, rcs: 2400, drive: '2 fusion torches', reactor: 'Tokamak, 1.4 GW',
    armor: 30, hull: 1100, maxSpd: 90, turn: 16, angAcc: 14, sensors: 150, price: 48000,
    note: 'Twenty boxes on a spine. The workhorse of every inner-system lane.' },
  { id: 'prospector', name: 'Prospector', cls: 'Mining ship', cat: 'yard', maker: 'Deepcut Mining Co.', built: 2203, crew: 6, berths: 8,
    dry: 1900, prop: 500, cargo: 3000, thrust: 16800, isp: 7000, rcs: 4800, drive: '4 fusion torches', reactor: 'Tokamak, 2.6 GW',
    armor: 80, hull: 2400, maxSpd: 70, turn: 11, angAcc: 9, sensors: 200, price: 62000,
    note: 'Drill head forward, ore hoppers down the flanks. Slow, stubborn, nearly unkillable.' },
  { id: 'lance', name: 'Lance', cls: 'Corvette', cat: 'yard', maker: 'Kessler Arms', built: 2224, crew: 12, berths: 16,
    dry: 3100, prop: 900, cargo: 200, thrust: 52000, isp: 15000, rcs: 9000, drive: '5 fusion torches', reactor: 'Tokamak, 7 GW',
    armor: 140, hull: 3600, maxSpd: 160, turn: 14, angAcc: 12, sensors: 900, price: 95000,
    note: 'Decommissioned picket ship, demilitarised on paper. Quick for her size.' },
  { id: 'atlas', name: 'Atlas', cls: 'Bulk hauler', cat: 'yard', maker: 'Meridian Lines', built: 2189, crew: 9, berths: 14,
    dry: 14000, prop: 4000, cargo: 26000, thrust: 90000, isp: 14000, rcs: 22000, drive: '4 fusion torches', reactor: 'Tokamak, 12 GW',
    armor: 40, hull: 6000, maxSpd: 75, turn: 5, angAcc: 3, sensors: 300, price: 140000,
    note: 'Forty containers on a 120 m truss. Plan your turns a minute ahead.' },
  // ---- found adrift ----------------------------------------------------------------------------------
  { id: 'gull', name: 'Old Gull', cls: 'Survey craft', cat: 'derelict', maker: 'Lunar Survey Office', built: 2141, crew: 4, berths: 4,
    dry: 120, prop: 40, cargo: 10, thrust: 1300, isp: 900, rcs: 380, drive: '1 nuclear-thermal bell', reactor: 'RTG stack, 3 MW',
    armor: 10, hull: 400, maxSpd: 70, turn: 30, angAcc: 40, sensors: 2500, salvage: 9000,
    note: 'A hundred-year-old surveyor with its science ring still on. Someone kept it running for a long time.' },
  { id: 'sable', name: 'Sable', cls: 'Stealth runner', cat: 'derelict', maker: 'Unknown', built: 2235, crew: 2, berths: 2,
    dry: 60, prop: 25, cargo: 6, thrust: 2600, isp: 16000, rcs: 640, drive: '2 slot torches, shrouded', reactor: 'Aneutronic fusion, 120 MW',
    armor: 18, hull: 260, maxSpd: 240, turn: 85, angAcc: 200, sensors: 600, salvage: 40000,
    note: 'Black, faceted, no registry. Whoever flew it did not want to be seen, and is not here now.' },
  { id: 'vigil', name: 'Vigil', cls: 'Research vessel', cat: 'derelict', maker: 'Coriolis Institute', built: 2207, crew: 40, berths: 60,
    dry: 6500, prop: 1500, cargo: 400, thrust: 40000, isp: 18000, rcs: 9000, drive: '4 fusion torches', reactor: 'Tokamak, 9 GW',
    armor: 25, hull: 3000, maxSpd: 80, turn: 7, angAcc: 5, sensors: 8000, salvage: 55000,
    note: 'Two spin rings, one of them torn open. The labs are sealed and dark.' },
  { id: 'cinder', name: 'Cinder', cls: 'Frigate, burned out', cat: 'derelict', maker: 'Kessler Arms', built: 2219, crew: 60, berths: 80,
    dry: 9800, prop: 2200, cargo: 600, thrust: 62000, isp: 15000, rcs: 14000, drive: '5 fusion torches (2 dead)', reactor: 'Tokamak, 11 GW (scrammed)',
    armor: 160, hull: 5200, maxSpd: 110, turn: 8, angAcc: 6, sensors: 1200, salvage: 70000,
    note: 'Gutted by a hit to the port flank. Three of her five drives still light.' },
  { id: 'ironwake', name: 'Ironwake', cls: 'Ore carrier, 1.1 km', cat: 'derelict', maker: 'Meridian Lines', built: 2172, crew: 220, berths: 300,
    dry: 2100000, prop: 300000, cargo: 4000000, thrust: 6000000, isp: 30000, rcs: 1400000, drive: '7 fusion torches, 19 m bells', reactor: '3 tokamaks, 160 GW',
    armor: 300, hull: 90000, maxSpd: 60, turn: 3.2, angAcc: 0.9, sensors: 20000, salvage: 900000, walk: true,
    note: 'Thirty ore cans on a 600 m spine. Dark for decades. Her hangar bay is still open.' },
];
export const BY_ID = Object.fromEntries(SHIPS.map((s) => [s.id, s]));

// your own salvage jet, for comparison in the list
export const SKIFF = { id: 'skiff', name: 'Skiff', cls: 'Salvage jet (yours)', cat: 'own', maker: 'Rell Salvage', built: 2233, crew: 1, berths: 1,
  dry: 8, prop: 1, cargo: 0.4, thrust: 180, isp: 4200, rcs: 95, drive: '2 vectored torches', reactor: 'Fuel cells, 2 MW', armor: 12, hull: 100, maxSpd: 58, turn: 190, angAcc: 400, sensors: 30,
  len: 4.6, beam: 4.6, height: 1.9, note: 'Small, quick, and fitted with a tow winch.' };

// numbers worth showing that follow from the spec
export function derived(s, fuel = 1) {
  const m0 = s.dry + s.prop, m = s.dry + s.prop * fuel;
  return {
    mass: m,                                         // tonnes
    accel: s.thrust / m,                             // m/s^2 (kN / t)
    g: s.thrust / m / G0,
    lat: s.rcs / m,                                  // RCS m/s^2
    dv: s.isp * G0 * Math.log(m0 / s.dry) / 1000,    // km/s, full tank
    flow: s.thrust * 1000 / (s.isp * G0),            // kg/s at full thrust
    burn: s.prop * 1000 / (s.thrust * 1000 / (s.isp * G0)),   // seconds of full thrust on a full tank
    twr: s.thrust / (s.dry + s.prop + s.cargo),       // loaded accel, m/s^2
  };
}

export function fmtMass(t) { return t >= 1e6 ? (t / 1e6).toFixed(2) + ' Mt' : t >= 1e3 ? (t / 1e3).toFixed(t >= 1e4 ? 0 : 1) + ' kt' : t >= 10 ? Math.round(t) + ' t' : t.toFixed(1) + ' t'; }
export function fmtForce(kn) { return kn >= 1e6 ? (kn / 1e6).toFixed(1) + ' GN' : kn >= 1e3 ? (kn / 1e3).toFixed(kn >= 1e4 ? 0 : 1) + ' MN' : Math.round(kn) + ' kN'; }
export function fmtCr(n) { return Math.round(n).toLocaleString('en-US'); }
