// Real station ids from the generated OSM index.
export const CMC = 'n3752876608'; // terminal, no OSM route directions
export const ST_MICHAEL = 'n3752876609'; // ~860 m from CMC
export const TZNA = 'n10672961242'; // "3 Kutir (TZNA Area)", OSM directions ayer-tena, bethel
export const MGMT_INSTITUTE = 'n3752876611';
export const LAM_BERET = 'n10794916505';
export const GURD_SHOLLA = 'n3752876612';
export const FAR_SOUTH = 'n10672739815'; // "ODDA Fuel Station", ~20 km south of CMC

export const DEVICE = 'dev_aaaaaaaaaaaaaaaaaaaa';
export const report = (over: Record<string, unknown> = {}) => ({
  station: CMC,
  direction: 'megenagna',
  queue: 'long',
  taxis: 'arriving',
  device: DEVICE,
  ...over,
});
