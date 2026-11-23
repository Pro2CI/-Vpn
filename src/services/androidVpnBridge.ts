import {ConnectionStatus, ProfileProtocol, SplitTunnelMode} from '../types/vpn';
export interface NativeAndroidBridge {
 connect:(configText:string,splitMode:SplitTunnelMode,packagesJson:string)=>void;
 connectAny?:(protocol:string,configText:string,splitMode:SplitTunnelMode,packagesJson:string)=>void;
 hasNativeCore?:(protocol:string)=>boolean;
 disconnect:()=>void;
 getState:()=>string;
}
declare global { interface Window { VioletAndroidBridge?:NativeAndroidBridge; onVioletVpnState?:(state:string,errorMessage?:string)=>void } }
export function isNativeAndroidBridgeAvailable(){return typeof window!=='undefined'&&!!window.VioletAndroidBridge}
export function connectNativeAnyProtocol(protocol:ProfileProtocol,configText:string,splitMode:SplitTunnelMode,packageNames:string[]){
 const b=window.VioletAndroidBridge;if(!isNativeAndroidBridgeAvailable()||!b)return false;
 if(typeof b.connectAny==='function'){b.connectAny(protocol,configText,splitMode,JSON.stringify(packageNames));return true}
 if(protocol==='wireguard'||protocol==='amneziawg'){b.connect(configText,splitMode,JSON.stringify(packageNames));return true}
 return false;
}
export function connectNativeWireGuard(configText:string,splitMode:SplitTunnelMode,packageNames:string[]){return connectNativeAnyProtocol('wireguard',configText,splitMode,packageNames)}
export function disconnectNativeWireGuard(){if(!isNativeAndroidBridgeAvailable()||!window.VioletAndroidBridge)return false;window.VioletAndroidBridge.disconnect();return true}
export function subscribeNativeVpnEvents(onStateChange:(status:ConnectionStatus,error?:string)=>void){
 if(typeof window==='undefined')return ()=>{};
 window.onVioletVpnState=(state,error)=>{if(['connected','connecting','disconnected','disconnecting'].includes(state))onStateChange(state as ConnectionStatus,error||undefined)};
 return ()=>{delete window.onVioletVpnState}
}