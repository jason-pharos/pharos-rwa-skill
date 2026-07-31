import { ethers } from 'ethers';
const A='0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6';
const abi=['function balanceOf(address) view returns (uint256)'];
const targets=[
 ['pharos','https://rpc.pharos.xyz','0xE47E9bA4EA2320A6ed87246d02Fd5C38485Ed7d1'],
 ['eth-publicnode','https://ethereum-rpc.publicnode.com','0xC3AaCb558aFB635307B66FDb405188138576fc4c'],
 ['eth-llama','https://eth.llamarpc.com','0xC3AaCb558aFB635307B66FDb405188138576fc4c'],
 ['eth-ankr','https://rpc.ankr.com/eth','0xC3AaCb558aFB635307B66FDb405188138576fc4c'],
 ['eth-drpc','https://eth.drpc.org','0xC3AaCb558aFB635307B66FDb405188138576fc4c'],
];
for (const [name,url,tok] of targets){
  try{
    const p=new ethers.JsonRpcProvider(url,undefined,{staticNetwork:true});
    const b=await new ethers.Contract(tok,abi,p).balanceOf(A);
    console.log(name,'OK balance=',b.toString());
  }catch(e){ console.log(name,'FAIL', String(e.shortMessage||e.message).slice(0,120)); }
}
