const topo=require('../node_modules/world-atlas/countries-50m.json');
const {feature}=require('topojson-client');
const ids={'642':'Romania','348':'Hungary','688':'Serbia','100':'Bulgaria','804':'Ukraine','498':'Moldova'};
const fc=feature(topo,topo.objects.countries);
const r=n=>Math.round(n*100)/100;
const out=fc.features.filter(f=>ids[f.id]).map(f=>{
  const clip=ring=>ring.map(([x,y])=>[r(x),r(y)]).filter((p,i,a)=>i==0||p[0]!=a[i-1][0]||p[1]!=a[i-1][1]);
  let g=f.geometry; let polys=g.type=='Polygon'?[g.coordinates]:g.coordinates;
  // keep only polygons near the region
  polys=polys.filter(p=>p[0].some(([x,y])=>x>18&&x<32&&y>42&&y<50)).map(p=>p.map(clip));
  return {name:ids[f.id],polys};
});
require('fs').writeFileSync(require('path').join(__dirname,'..','build','geo.json'),JSON.stringify(out));
console.log(out.map(o=>o.name+':'+o.polys.length), JSON.stringify(out).length);
