import aircode from 'aircode';

export default async function() {
  const dbs = aircode.db.table('persons');
  const query = dbs.where();
  console.log('query start');
  const result = await query.find();
  console.log('query end');
  return {
    result,
  };
}