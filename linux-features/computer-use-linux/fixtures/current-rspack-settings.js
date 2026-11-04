"use strict";

module.exports = String.raw`function s(e){let t,n=(0,r.c)(3),{computerUseAvailability:s,hostId:o}=e,{isLoading:l,platform:u}=(0,i.V)(),d=(0,a.Zj)("419294242"),c="local"===o,p=c&&(l||"macOS"===u&&s.isLoading),h=c&&!p&&"macOS"===u&&s.available&&d;return n[0]!==p||n[1]!==h?(t={available:h,isLoading:p},n[0]=p,n[1]=h,n[2]=t):t=n[2],t}`;
