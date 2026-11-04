export const __rspack_esm_id=620883;
export const __webpack_modules__={XpSi(e,t,a){
const w={avatarOverlay:{completeQuickChatFocus(){return Promise.resolve(true)},codexPetOverlayCompleteDrag(){return Promise.resolve(true)},setQuickChatStashed(){}}};
let service={avatarOverlay:{setQuickChatStashed(){}}};service.avatarOverlay?.setQuickChatStashed(null);
function n6(e){let{quickChatFocusPreparation:h}=e;let o=()=>{if(null==w.avatarOverlay||h?.layoutRevision==null)return;let{requestId:e,layoutRevision:t}=h,a=window.requestAnimationFrame(()=>{a=window.requestAnimationFrame(()=>{w.avatarOverlay.completeQuickChatFocus(e,t).then(t=>{}).catch(n8)})});return()=>{window.cancelAnimationFrame(a)}};return o}
function n8(e){}
let G={O1:{dispatchMessage(){}}},rA={current:null},oo=()=>{},aX=e=>e,aY=e=>e;
let rN=()=>{},rM=()=>{},r1=()=>{},aC=()=>{},iF=null,iI=false,iM=null;
let layoutConsumer=e=>{let{isGlobalRealtimeVoicePresentation:t,isVisible:a,layout:i,layoutRevision:n,petOpenIntent:o}=e;return i};
let dragStart=e=>{let t=false;rA.current={beganOnQuickChatBar:false,hasMoved:false,pointerId:e.pointerId,samples:[],usesOrbPhysics:false};G.O1.dispatchMessage("avatar-overlay-drag-start",{pointerScreenX:e.screenX,pointerWindowX:e.clientX,pointerWindowY:e.clientY,usesOrbPhysics:t})};
let rU=(e,t)=>{var a,i,n,r;let l,s=rA.current;if(null==s||s.pointerId!==e.pointerId)return;rA.current=null;let{hasMoved:u,releaseSample:d,velocity:p}={hasMoved:s.hasMoved,releaseSample:e,velocity:null};s.beganOnQuickChatBar&&console.debug("Quick Chat pointer gesture finished");if(u)G.O1.dispatchMessage("avatar-overlay-drag-move",{pointerScreenX:e.screenX,pointerScreenY:e.screenY});let m=d??s.samples.at(-1)??s;G.O1.dispatchMessage("avatar-overlay-drag-end",{altKey:t&&!s.usesOrbPhysics&&e.altKey,pointerScreenX:m.screenX,pointerScreenY:m.screenY});t&&s.beganOnQuickChatBar&&!u&&aC();s.usesOrbPhysics&&p&&G.O1.dispatchMessage("avatar-overlay-drag-release",{shouldBounce:true,velocityX:p.x*3,velocityY:p.y*3});
};
}};
