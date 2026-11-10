"use strict";
const renderer = require("./patch.js");
const manager = require("./manager-patch.js");
module.exports = { descriptors: [...renderer.descriptors, ...manager.descriptors] };
