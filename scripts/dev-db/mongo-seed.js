// Sample data for the throwaway MongoDB (scripts/dev-db/mongo-start.sh).
// These are local test credentials for a server that only listens on 127.0.0.1.
//   app     readWrite on the events database   password: berth-dev-app
//   app_ro  read on the events database        password: berth-dev-ro
rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${db.getMongo().getURI().match(/:(\d+)\//)[1]}` }] });
while (!db.hello().isWritablePrimary) sleep(200);

db.getSiblingDB('admin').createUser({ user: 'berth-admin', pwd: 'berth-dev-admin', roles: ['root'] });
db.getSiblingDB('admin').auth('berth-admin', 'berth-dev-admin');

const events = db.getSiblingDB('events');
events.createUser({ user: 'app', pwd: 'berth-dev-app', roles: [{ role: 'readWrite', db: 'events' }] });
events.createUser({ user: 'app_ro', pwd: 'berth-dev-ro', roles: [{ role: 'read', db: 'events' }] });

const types = ['click', 'view', 'purchase'];
const now = Date.now();
events.events.insertMany(Array.from({ length: 500 }, (_, i) => ({
  type: types[i % 3],
  user: `u${i % 50}`,
  at: new Date(now - i * 60000),
  ...(i % 3 === 2 ? { amount: NumberDecimal('19.99') } : {}),
  meta: { source: ['web', 'ios', 'android'][i % 3], tags: i % 5 === 0 ? ['promo', 'q4'] : [] },
})));
events.events.createIndex({ type: 1, at: -1 });
events.sessions.insertMany(Array.from({ length: 40 }, (_, i) => ({
  user: `u${i}`,
  startedAt: new Date(now - i * 3600000),
  device: { os: i % 2 ? 'ios' : 'android', version: `${14 + (i % 4)}.0` },
  pages: i % 7,
})));
events.createView('purchases', 'events', [{ $match: { type: 'purchase' } }]);
