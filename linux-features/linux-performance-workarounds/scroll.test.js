"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyLinuxSidebarScrollPerformancePatch,
  matchesLinuxSidebarScrollPerformanceContract,
} = require("./scroll.js");

function currentRspackSidebarFixture() {
  return 'function render(){return(0,r.jsx)("div",{...cU.rW.sidebarScroll,className:(0,s.A)("relative isolate mb-[var(--sidebar-footer-height)] flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto scroll-pb-[var(--padding-row-x)] pt-(--sidebar-scroll-content-top-padding) pb-row-x [--radius-token-row:10px] [contain:layout_paint] browser:gap-5",bi.A.headerFadeMask,V?bi.A.withoutFooterFade:"vertical-scroll-fade-mask",F&&bi.A.stickySectionHeaders,t&&"pointer-events-none"),ref:T,onScroll:e=>{let t=J.current;(null==t||e.timeStamp-t>=250)&&((0,C.e)(),J.current=e.timeStamp),(0,br.yg)();let{scrollTop:n}=e.currentTarget;G||(k?.(n>0),v(n))},children:[]})}';
}

test("current Rspack sidebar container is discoverable and patchable", () => {
  const source = currentRspackSidebarFixture();
  assert.equal(matchesLinuxSidebarScrollPerformanceContract(source), true);
  const patched = applyLinuxSidebarScrollPerformancePatch(source);
  assert.notEqual(patched, source);
  assert.match(patched, /className:\(0,s\.A\)\([\s\S]*?\),style:\{animationName:`none`,animationTimeline:`auto`/u);
  assert.doesNotThrow(() => new Function(patched));
  assert.equal(matchesLinuxSidebarScrollPerformanceContract(patched), true);
  assert.equal(applyLinuxSidebarScrollPerformancePatch(patched), patched);
});

test("sidebar matching rejects duplicate, partial, and unrelated containers", () => {
  const source = currentRspackSidebarFixture();
  assert.equal(matchesLinuxSidebarScrollPerformanceContract(source + source), false);
  assert.equal(matchesLinuxSidebarScrollPerformanceContract(source.replace("[contain:layout_paint]", "[contain:content]")), false);
  assert.equal(matchesLinuxSidebarScrollPerformanceContract(source.replace("let{scrollTop:n}=e.currentTarget;", "let n=0;")), false);
});
