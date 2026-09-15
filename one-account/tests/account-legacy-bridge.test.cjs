const test=require('node:test'); const assert=require('node:assert/strict');
const {projectExposures}=require('../public/account-legacy-bridge.js');
test('relationship table preserves missing amounts vs zero and excludes raw lineage',()=>{
 const rows=projectExposures([{exposure_id:'E',amount_primary:0,role_label:'LP',source_file:'private.xlsx',lineage_paths:['private']},{exposure_id:'F',amount_primary:null}]);
 assert.equal(rows[0].amount,0);assert.equal(rows[1].amount,null);
 assert.equal(rows[0].source_file,undefined);assert.equal(rows[0].lineage_paths,undefined);
});
