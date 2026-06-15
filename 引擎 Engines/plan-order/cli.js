// Thin Node bridge for the launchpad plan manager: read a JSON object
// { structure, entries, dev, devTitle, leafSort } on stdin, run the shared
// PlanOrder.buildModel, and write the numbered model as JSON on stdout. The
// Python side parses the YAML (it already does, via ruamel) and renders the
// result — so order and numbering come from the same engine the webpages use.
const PlanOrder = require('./plan-order.js');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  let opts;
  try {
    opts = JSON.parse(input || '{}');
  } catch (e) {
    process.stderr.write('plan-order/cli.js: invalid JSON on stdin: ' + e.message + '\n');
    process.exit(1);
    return;
  }
  try {
    process.stdout.write(JSON.stringify(PlanOrder.buildModel(opts)));
  } catch (e) {
    process.stderr.write('plan-order/cli.js: buildModel failed: ' + e.message + '\n');
    process.exit(1);
  }
});
