const fs = require('fs');
const path = require('path');
const templates = JSON.parse(fs.readFileSync(path.join(__dirname, '.generated/dashboard-js.json'), 'utf8'));
for (const source of templates) {
  const fn = new Function('states', 'entity', 'variables', source);
  fn({}, undefined, {room_key: 'salon'});
  fn({
    'input_boolean.chauffage_autorise': {state: 'on'},
    'input_boolean.chauffage_absent': {state: 'off'},
    'input_select.chauffage_salon_mode': {state: 'Planning'}
  }, {state: 'heat', attributes: {temperature: 20, current_temperature: 21.5, hvac_action: 'heating'}}, {room_key: 'salon'});
}
console.log('PASS: expressions JavaScript du tableau de bord, avec entités présentes et absentes.');
