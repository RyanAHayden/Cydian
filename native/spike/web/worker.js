// Module worker for the probe: proves workers load from the app's custom scheme (Packages parsing runs in one).
import { rowData } from './list.js';
self.onmessage = (e) => {
  let bytes = 0;
  for (let i = 0; i < e.data.rows; i++) bytes += rowData(7, i).desc.length;
  self.postMessage({ rows: e.data.rows, bytes });
};
