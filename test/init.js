const chai = require('chai');
const sinon = require('sinon');
const expect = chai.expect;

chai.use(require('sinon-chai'));
chai.use(require('chai-string'));

global.expect = expect;
global.sinon = sinon;
global.chai = chai;


