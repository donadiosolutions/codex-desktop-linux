"use strict";

const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");

const SIDEBAR_STYLE =
  "{animationName:`none`,animationTimeline:`auto`,\"--bottom-fade\":`calc(var(--spacing) * 10)`}";
const SIDEBAR_WARNING =
  "WARN: Could not uniquely identify the main sidebar scroll container — skipping Linux sidebar scroll performance patch";

function sidebarContainers(source) {
  const anchors = /sidebarScroll,className:/gu;
  const containers = [];
  for (const anchor of source.matchAll(anchors)) {
    const tail = source.slice(anchor.index, anchor.index + 6000);
    const props = tail.match(/,ref:[A-Za-z_$][\w$]*,onScroll:[A-Za-z_$][\w$]*=>\{/u);
    if (props?.index == null) continue;
    const className = tail.slice(0, props.index);
    if (!className.includes("vertical-scroll-fade-mask") ||
        !className.includes("[contain:layout_paint]") ||
        !className.includes(".headerFadeMask")) continue;
    const handlerOpen = anchor.index + props.index + props[0].lastIndexOf("{");
    const handlerClose = findMatchingBrace(source, handlerOpen);
    if (handlerClose === -1) continue;
    const handler = source.slice(handlerOpen, handlerClose + 1);
    if (!/let\{scrollTop:[A-Za-z_$][\w$]*\}=[A-Za-z_$][\w$]*\.currentTarget/u.test(handler)) continue;
    containers.push({ insertion: anchor.index + props.index, styleComplete: className.includes(`,style:${SIDEBAR_STYLE}`) });
  }
  return containers;
}

function matchesLinuxSidebarScrollPerformanceContract(source) {
  const containers = sidebarContainers(source);
  return containers.length === 1;
}

function applyLinuxSidebarScrollPerformancePatch(source) {
  const containers = sidebarContainers(source);
  if (containers.length === 1) {
    const container = containers[0];
    if (container.styleComplete) return source;
    return source.slice(0, container.insertion) + `,style:${SIDEBAR_STYLE}` + source.slice(container.insertion);
  }
  if (source.includes(".sidebarScroll") && source.includes("vertical-scroll-fade-mask")) {
    console.warn(SIDEBAR_WARNING);
  }
  return source;
}

module.exports = {
  applyLinuxSidebarScrollPerformancePatch,
  matchesLinuxSidebarScrollPerformanceContract,
};
