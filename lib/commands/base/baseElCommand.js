var util = require("util");
var EventEmitter = require("events").EventEmitter;
var _ = require("lodash");
var clc = require("cli-color");

var selectorUtil = require("../../util/selector");
var jsInjection = require("../../injections/js-injection");
var acquireSizzle = require("../../injections/acquire-sizzle");
var settings = require("../../settings");
var statsd = require("../../util/statsd");

function BaseElCommand() {
  EventEmitter.call(this);
  this.startTime = 0;
  this.successMessage = "";
  this.failureMessage = "";

  this.time = {
    totalTime: 0,
    seleniumCallTime: 0,
    executeAsyncTime: 0
  };
};

util.inherits(BaseElCommand, EventEmitter);

_.assign(BaseElCommand.prototype, jsInjection);

BaseElCommand.prototype.decide = function () {
  if (_.indexOf(settings.syncModeBrowserList,
      this.client.desiredCapabilities.browserName.toLowerCase()) > -1) {
    // urrrrhhhhhh, we have to execute everything synchronously and slowly
    this.nightwatchExecute = this.client.api.execute;
    this.executeSizzlejs = this.executeSizzlejsSync;
  } else {
    this.nightwatchExecute = this.client.api.executeAsync;
    this.executeSizzlejs = this.executeSizzlejsAsync;
  }
};

BaseElCommand.prototype.execute = function (fn, args, callback) {
  var self = this;

  var innerArgs = _.cloneDeep(args);
  var selector = selectorUtil.depageobjectize(innerArgs.shift(), this.client.locateStrategy)

  innerArgs.unshift(selector);
  innerArgs.push(this.getSizzlejsSource());
  innerArgs.push(settings.JS_WAIT_INTERNAL);
  innerArgs.push(settings.JS_SEEN_MAX);

  this.nightwatchExecute(fn, innerArgs, function (result) {
      if (settings.verbose) {
        console.log("execute(" + innerArgs + ") intermediate result: ", result);
      }
      if (result && result.status === 0 && result.value !== null) {
        // Note: by checking the result and passing result.value to the callback,
        // we are claiming that the result sent to the callback will always be truthy
        // and useful, relieving the callback from needing to check the structural
        // validity of result or result.value

        callback.call(self, result.value);
      } else if (result && result.status === -1 && result.errorStatus === 13 && result.value !== null) {
        // errorStatus = 13: javascript error: document unloaded while waiting for result
        // we want to reload the page
        callback.call(self, {
          seens: 0,
          jsDuration: 0,
          jsStepDuration: [],
          isResultReset: true,
          isVisibleStrict: null,
          isVisible: false,
          selectorVisibleLength: 0,
          selectorLength: 0,
          value: {
            sel: null,
            value: null
          }
        });
      } else {
        console.log(clc.yellowBright("\u2622  Received error result from Selenium. Raw Selenium result object:"));
        var resultDisplay;
        try {
          resultDisplay = stringify(result);
        } catch (e) {
          resultDisplay = util.inspect(result, false, null);
        }
        console.log(clc.yellowBright(resultDisplay));
        self.fail();
      }
    });
};

BaseElCommand.prototype.pass = function (actual, expected) {
  var pactual = pexpected = actual || "visible";
  this.time.totalTime = (new Date()).getTime() - this.startTime;
  this.client.assertion(true, pactual, pexpected, util.format(this.successMessage, this.time.totalTime), true);

  statsd({
    capabilities: this.client.options.desiredCapabilities,
    type: "command",
    cmd: this.cmd,
    value: this.time
  });

  if (this.cb) {
    this.cb.apply(this.client.api, [actual]);
  }
  this.emit("complete");
};

// Optionally take in a different text for expected and actual values, but default to "visible", and "not visible".
BaseElCommand.prototype.fail = function (actual, expected) {
  var pactual = actual || "not visible";
  var pexpected = expected || "visible";
  this.time.totalTime = (new Date()).getTime() - this.startTime;
  this.client.assertion(false, pactual, pexpected, util.format(this.failureMessage, this.time.totalTime), true);
  if (this.cb) {
    this.cb.apply(this.client.api, []);
  }
  this.emit("complete");
};

module.exports = BaseElCommand;
