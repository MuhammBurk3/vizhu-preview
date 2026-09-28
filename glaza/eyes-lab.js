// Вижу · лаборатория глаз. Один фрагментный шейдер WebGL2: глазное яблоко с
// преломлением в роговице, веки, ресницы, брови из волосков и синтетическая
// кожа, которая проявляется складками только во время эмоций.
(function () {
  'use strict';

  var FRAG = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2 uRes; uniform vec2 uMid; uniform float uScale; uniform float uSep;',
    'uniform vec4 uGaze; uniform vec4 uA0, uA1, uB0, uB1, uC; uniform vec2 uPupil;',
    'uniform vec3 uSkin, uSSS, uBrowCol, uLidInner; uniform float uDay, uOptics, uHasIris;',
    'uniform sampler2D uIris;',
    'out vec4 outColor;',
    'const float PI = 3.14159265;',
    'float hash21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }',
    'float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);',
    '  return mix(mix(hash21(i),hash21(i+vec2(1,0)),u.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),u.x), u.y); }',
    'float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.03+7.1; a*=.5; } return s; }',
    'vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }',

    // ---------------- geometry shared by skin, lids and brows ----------------
    'void lidCurves(float xl, vec4 A, float gy, out float up, out float lo, out float k, out float t){',
    '  t = clamp(xl, -1., 1.);',
    '  k = max(1. - t*t, 0.);',
    '  float base = mix(-0.17, -0.075, (t+1.)*.5);',
    '  float base0 = -0.1225;',
    '  up = base + (0.445*A.x)*pow(k, 0.80)*(1. - 0.10*t) + gy*0.13*k;',
    '  lo = base - (0.275 - 0.09*A.z)*pow(k, 1.10)*(1. + 0.16*t) + gy*0.05*k + A.z*0.03*k;',
    '  float meet = lo + 0.03*k;',
    '  up = mix(up, meet, A.y);',
    '  lo = mix(lo, meet - 0.004, A.y*0.12);',
    '}',
    'float browY(float xl, vec4 B){',
    '  float s = clamp((xl + 1.02)/2.0, 0., 1.);',
    '  return 0.80 + 0.12*sin(PI*pow(s, 0.75)) - 0.07*pow(s, 3.) + 0.26*B.x*pow(1.-s, 1.5) + 0.20*B.y*pow(s, 1.3) - 0.18*B.z*(1. - 0.35*s) - 0.07*B.w*pow(1.-s, 2.);',
    '}',
    'float creaseOf(vec4 A){ return 0.16 + 0.07*(1. - clamp(A.x, 0., 1.3)) ; }',

    // Height of the skin around one eye; wr collects wrinkle grooves (for occlusion).
    'float eyeHeight(vec2 p, float side, vec4 A, vec4 B, float gy, float ue, inout float wr){',
    '  float xl = p.x*side;',
    '  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);',
    '  float aboveU = p.y - up, belowL = lo - p.y;',
    '  float span = smoothstep(1.08, 0.7, abs(xl));',
    '  float cr = creaseOf(A);',
    '  float h = 0.035*smoothstep(-0.01, 0.05, aboveU)*smoothstep(cr + 0.05, cr - 0.02, aboveU)*span;',
    '  h -= 0.007*exp(-pow((aboveU - cr)/0.045, 2.))*span;',
    '  float yb = browY(xl, B);',
    '  h += 0.07*exp(-pow((p.y - (yb - 0.06))/0.17, 2.))*smoothstep(1.45, 0.55, abs(xl - 0.05));',
    '  h += (0.012 + 0.045*A.z)*exp(-pow((belowL - 0.06)/0.045, 2.))*span;',
    '  h += 0.08*A.z*exp(-pow((belowL - 0.36)/0.20, 2.))*smoothstep(1.35, 0.3, abs(xl - 0.1));',
    '  float w = 0.;',
    '  vec2 d = vec2(xl, p.y) - vec2(0.96, -0.07);',
    '  float r = length(d); float th = atan(d.y, d.x);',
    '  if (A.w > 0.01 && d.x > -0.20 && r < 0.66) {',
    '    for (int i = 0; i < 5; i++) {',
    '      float fi = float(i);',
    '      float a0 = -0.58 + fi*0.29 + 0.06*sin(fi*3.7);',
    '      float c = (fi - 2.0)*0.14;',
    '      float dth = th - (a0 + c*r + 0.035*sin(r*18. + fi*2.1));',
    '      float ww = (0.013 + 0.020*r)*(0.8 + 0.4*noise(vec2(r*9., fi*5.)));',
    '      float len = 0.30 + 0.16*fract(sin(fi*12.9898)*43758.5);',
    '      float g = exp(-pow(r*dth/ww, 2.))*smoothstep(0.13, 0.24, r)*smoothstep(len + 0.12, len*0.55, r);',
    '      w += g*(0.55 + 0.25*sin(fi*2.3 + 1.))*(0.7 + 0.3*noise(vec2(r*14., fi)));',
    '    }',
    '    w *= A.w;',
    '  }',
    '  float yj = 0.21 - 0.06*A.z;',
    '  float under = step(0., belowL);',
    '  w += ue*0.9*exp(-pow((belowL - yj)/0.022, 2.))*smoothstep(1.0, 0.15, abs(xl - 0.1))*under;',
    '  w += A.z*0.55*exp(-pow((belowL - yj*0.55)/0.013, 2.))*smoothstep(0.95, 0.3, abs(xl - 0.28))*under;',
    '  w += A.z*0.45*exp(-pow((belowL - yj*0.8)/0.012, 2.))*smoothstep(0.7, 0.2, abs(xl - 0.45))*under;',
    '  wr += w;',
    '  return h - 0.020*w;',
    '}',
    'float innerBrowY(){ return 0.5*(browY(-1.02, uB0) + browY(-1.02, uB1)); }',
    'float globalHeight(vec2 q, inout float wr){',
    '  float yI = innerBrowY();',
    '  float w = 0.;',
    '  for (int s = 0; s < 2; s++) {',
    '    float sg = s == 0 ? -1. : 1.;',
    '    float xs = sg*(0.105 - 0.025*uC.x);',
    '    float xw = q.x - xs + sg*0.10*(q.y - yI);',
    '    w += uC.x*0.85*exp(-pow(xw/0.024, 2.))*smoothstep(yI - 0.34, yI - 0.14, q.y)*smoothstep(yI + 0.30, yI + 0.06, q.y);',
    '    float xw2 = q.x - sg*0.17 + sg*0.05*(q.y - yI);',
    '    w += 0.5*uC.x*exp(-pow(xw2/0.012, 2.))*smoothstep(yI - 0.22, yI - 0.10, q.y)*smoothstep(yI + 0.16, yI + 0.02, q.y);',
    '  }',
    '  for (int j = 0; j < 2; j++) {',
    '    float yj = yI - 0.40 - float(j)*0.075;',
    '    w += uC.y*0.85*exp(-pow((q.y - yj)/0.013, 2.))*smoothstep(0.21, 0.05, abs(q.x));',
    '  }',
    '  for (int j = 0; j < 3; j++) {',
    '    float yj = yI + 0.40 + float(j)*0.14 + 0.03*sin(q.x*2.1 + float(j)*1.7);',
    '    float fx = abs(abs(q.x) - uSep*0.78);',
    '    w += uC.z*0.75*exp(-pow((q.y - yj)/0.017, 2.))*smoothstep(0.95, 0.15, fx);',
    '  }',
    '  wr += w;',
    '  float bulge = 0.03*uC.x*exp(-pow(q.x/0.07, 2.))*smoothstep(yI - 0.36, yI - 0.12, q.y)*smoothstep(yI + 0.30, yI, q.y);',
    '  return bulge - 0.020*w;',
    '}',
    'float totalH(vec2 q, inout float wr){',
    '  float h = globalHeight(q, wr);',
    '  h += eyeHeight(q - vec2(-uSep, 0.), -1., uA0, uB0, uGaze.y, uC.w, wr);',
    '  h += eyeHeight(q - vec2( uSep, 0.),  1., uA1, uB1, uGaze.w, uC.w, wr);',
    '  h += 0.0016*fbm(q*55.);',
    '  return h;',
    '}',

    // ---------------- skin visibility ----------------
    'float eyeSkinAlpha(vec2 p, float side, vec4 A, vec4 B, float gy, float ue){',
    '  float xl = p.x*side;',
    '  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);',
    '  float aboveU = p.y - up, belowL = lo - p.y;',
    '  float dOut = max(max(aboveU, belowL), 0.) + max(abs(xl) - 1., 0.)*1.2;',
    '  float lidA = exp(-dOut/0.085)*smoothstep(1.3, 0.95, abs(xl));',
    '  float cr = creaseOf(A);',
    '  float upperA = mix(0.95, 0.30, smoothstep(0.0, cr, aboveU))*smoothstep(cr + 0.26, cr - 0.04, aboveU)*step(-0.02, aboveU)*smoothstep(1.12, 0.78, abs(xl));',
    '  float yb = browY(xl, B);',
    '  float bs = clamp((xl + 1.02)/2.0, 0., 1.); float bth = mix(0.135, 0.028, pow(bs, 0.9));',
    '  float browA = 0.42*smoothstep(bth*0.5 + 0.09, bth*0.5 - 0.01, abs(p.y - yb))*smoothstep(-1.12, -0.98, xl)*smoothstep(1.08, 0.90, xl);',
    '  vec2 d = vec2(xl, p.y) - vec2(1.02, -0.07);',
    '  float crowA = A.w*0.78*smoothstep(0.52, 0.08, length(d*vec2(0.95, 1.2)))*smoothstep(-0.42, 0.05, d.x);',
    '  float ueA = max(ue, A.z*0.85)*exp(-pow((belowL - 0.20)/0.16, 2.))*smoothstep(1.2, 0.35, abs(xl - 0.1))*step(-0.02, belowL);',
    '  return clamp(max(max(lidA, upperA*0.85), max(browA, max(crowA, ueA))), 0., 1.);',
    '}',
    'float globalAlpha(vec2 q){',
    '  float yI = innerBrowY();',
    '  float g = uC.x*0.8*exp(-pow(q.x/0.26, 2.) - pow((q.y - yI + 0.06)/0.26, 2.));',
    '  float n = uC.y*exp(-pow(q.x/0.26, 2.) - pow((q.y - yI + 0.44)/0.13, 2.));',
    '  float f = uC.z*0.8*exp(-pow((abs(q.x) - uSep*0.78)/0.85, 2.) - pow((q.y - yI - 0.56)/0.22, 2.));',
    '  return clamp(max(g, max(n*0.85, f)), 0., 1.);',
    '}',

    // ---------------- lighting ----------------
    'vec3 env(vec3 d, float day){',
    '  vec3 sky = mix(vec3(0.004,0.006,0.02), vec3(0.18,0.16,0.14), day);',
    '  vec2 w = vec2(d.x + 0.42, d.y - 0.46);',
    '  float rr = length(max(abs(w) - vec2(0.085, 0.060), 0.)) - 0.05;',
    '  vec3 c = sky + vec3(1.0,0.97,0.92)*smoothstep(0.035, -0.025, rr)*20.;',
    '  vec2 gd = d.xy - vec2(0.56,-0.34);',
    '  return c + lin(vec3(0.91,0.74,0.33))*exp(-60.*dot(gd,gd))*3.0;',
    '}',
    'float lidOccEye(vec2 p, float side, vec4 A, float gy){',
    '  float xl = p.x*side; float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);',
    '  float aboveU = p.y - up, belowL = lo - p.y;',
    '  float span = smoothstep(1.25, 0.9, abs(xl));',
    '  float o = 1.;',
    '  o *= mix(1., mix(0.22, 1., smoothstep(0.0, 0.075, aboveU)), span*step(-0.01, aboveU)*step(abs(xl), 1.2));',
    '  o *= mix(1., mix(0.55, 1., smoothstep(0.0, 0.05, belowL)), span*step(-0.01, belowL));',
    '  float cr = creaseOf(A);',
    '  o *= 1. - 0.25*exp(-pow((aboveU - cr - 0.01)/0.05, 2.))*span;',
    '  return o;',
    '}',
    'float proxEye(vec2 p, float side, vec4 A, float gy){',
    '  float xl = p.x*side; float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);',
    '  float dOut = max(max(p.y - up, lo - p.y), 0.) + max(abs(xl) - 1., 0.);',
    '  return exp(-dOut/0.22);',
    '}',
    'float lidOcc(vec2 q){ return min(lidOccEye(q - vec2(-uSep, 0.), -1., uA0, uGaze.y), lidOccEye(q - vec2(uSep, 0.), 1., uA1, uGaze.w)); }',
    'vec3 shadeSkin(vec2 q, float alpha){',
    '  float e = 1.2/uScale;',
    '  float w0 = 0., w1 = 0., w2 = 0.;',
    '  float h0 = totalH(q, w0);',
    '  float hx = totalH(q + vec2(e, 0.), w1);',
    '  float hy = totalH(q + vec2(0., e), w2);',
    '  vec3 N = normalize(vec3(-(hx - h0)/e*1.8, -(hy - h0)/e*1.8, 1.));',
    '  vec3 V = vec3(0., 0., 1.);',
    '  vec3 albedo = lin(mix(uSkin, vec3(0.93, 0.95, 1.0), uDay*0.70)), sss = lin(mix(uSSS, vec3(1.0), uDay*0.55));',
    '  vec3 L1 = normalize(vec3(-0.45, 0.65, 0.62));',
    '  vec3 L2 = normalize(vec3(0.55, -0.35, 0.75));',
    '  vec3 L3 = normalize(vec3(0.95, 0.15, 0.30));',
    '  float d1 = dot(N, L1);',
    '  float wrap = clamp((d1 + 0.45)/1.45, 0., 1.);',
    '  vec3 col = albedo*wrap*vec3(1.0, 0.97, 0.93)*1.05;',
    '  col += sss*pow(clamp(1. - abs(d1), 0., 1.), 2.)*0.18;',
    '  col += albedo*clamp(dot(N, L2)*0.5 + 0.5, 0., 1.)*lin(vec3(0.45, 0.55, 0.95))*0.22;',
    '  col += lin(vec3(0.91, 0.74, 0.33))*pow(clamp(dot(N, L3), 0., 1.), 3.)*0.10;',
    '  vec3 H = normalize(L1 + V);',
    '  float F = 0.04 + 0.96*pow(1. - clamp(N.z, 0., 1.), 5.);',
    '  col += vec3(1.)*pow(clamp(dot(N, H), 0., 1.), 36.)*0.10*(0.4 + F)*(1. - clamp(w0, 0., 1.));',
    '  float occl = (1. - clamp(w0*0.75, 0., 0.7))*lidOcc(q);',
    '  col *= occl;',
    '  col = mix(col, col*mix(vec3(1.), sss/max(albedo, vec3(0.001)), 0.12), 0.5);',
    '  float prox = max(proxEye(q - vec2(-uSep, 0.), -1., uA0, uGaze.y), proxEye(q - vec2(uSep, 0.), 1., uA1, uGaze.w));',
    '  col *= mix(mix(0.50, 0.85, uDay), 1.0, prox);',
    '  return col;',
    '}',

    // ---------------- eye ----------------
    'vec4 eyeball(vec2 p, float side, float lpx, vec2 gz, vec4 A, float pupil, float seed, out float inside, out float dU, out float dL){',
    '  float day = uDay;',
    '  float xl = p.x*side;',
    '  float up, lo, k, t; lidCurves(xl, A, gz.y, up, lo, k, t);',
    '  dU = up - p.y; dL = p.y - lo;',
    '  float gap = smoothstep(0.012, 0.035, up - lo + 0.03*k*0.);',
    '  inside = smoothstep(-lpx, lpx, dU)*smoothstep(-lpx, lpx, dL)*smoothstep(1.0 + lpx, 1.0 - lpx, abs(xl));',
    '  if (inside < 0.001) return vec4(0.);',
    '  float Rb = 1.02;',
    '  vec3 g = normalize(vec3(gz.x*0.62, gz.y*0.52, 1.0));',
    '  float cosI = cos(0.385); float Ri = Rb*sin(0.385);',
    '  vec3 ro = vec3(p, 6.), rd = vec3(0,0,-1);',
    '  float zb = sqrt(max(Rb*Rb - dot(p,p), 0.0001));',
    '  vec3 nb = normalize(vec3(p, zb));',
    '  vec3 L = normalize(vec3(-0.50, 0.62, 0.70));',
    '  vec3 sc = mix(lin(vec3(0.76,0.73,0.70)), lin(vec3(0.95,0.93,0.89)), day);',
    '  float corner = smoothstep(0.30, 1.0, abs(xl));',
    '  sc = mix(sc, mix(lin(vec3(0.80,0.66,0.66)), lin(uSSS), 0.35), corner*0.55);',
    '  float v = fbm(vec2(xl*7.0 + seed, p.y*11.0));',
    '  sc = mix(sc, lin(vec3(0.70,0.30,0.30)), smoothstep(0.016, 0.0, abs(v - 0.5))*corner*0.28);',
    '  float diff = clamp((dot(nb, L) + 0.45)/1.45, 0., 1.);',
    '  vec3 scl = sc*(0.30 + 0.85*diff)*(1. - 0.55*pow(1. - nb.z, 1.6));',
    '  vec3 surf = scl + (0.02 + 0.98*pow(1. - nb.z, 5.))*env(reflect(rd, nb), day)*0.12;',
    '  vec3 Cc = g*(Rb + 0.06 - 0.60);',
    '  vec3 oc = ro - Cc; float b = dot(oc, rd); float c = dot(oc,oc) - 0.36;',
    '  float disc = b*b - c;',
    '  float cm = 0.; vec3 ccol = vec3(0.);',
    '  if (disc > 0.) {',
    '    vec3 Pc = ro + rd*(-b - sqrt(disc));',
    '    cm = smoothstep(-0.004, 0.012, dot(Pc, g) - Rb*cosI);',
    '    if (cm > 0.) {',
    '      vec3 nc = normalize(Pc - Cc);',
    '      vec3 rt = refract(rd, nc, 1.0/1.376);',
    '      vec3 Ip = g*(Rb*cosI - 0.045);',
    '      vec3 Pi = Pc + rt*(dot(Ip - Pc, g)/dot(rt, g));',
    '      vec3 qq = Pi - Ip;',
    '      vec3 u = normalize(cross(vec3(0,1,0), g)); vec3 w = cross(g, u);',
    '      vec2 q2 = vec2(dot(qq,u), dot(qq,w))/Ri;',
    '      float r = length(q2); float a = atan(q2.y, q2.x);',
    '      float pr = pupil*(1. + 0.012*sin(a*5. + seed));',
    '      float s = clamp((r - pr)/(1. - pr), 0., 1.);',
    '      vec3 ir;',
    '      if (uHasIris > 0.5) {',
    '        vec2 dir = r > 1e-4 ? q2/r : vec2(0.);',
    '        vec2 tuv = 0.5 + vec2(dir.x, -dir.y)*mix(0.37, 1.0, s)*0.47*(side > 0. ? -1. : 1.);',
    '        ir = lin(texture(uIris, tuv).rgb)*1.35;',
    '      } else {',
    '        ir = mix(lin(vec3(0.93,0.70,0.30)), lin(vec3(0.62,0.34,0.10)), smoothstep(0.1, 0.7, s))*(0.5 + fbm(vec2(a*10., s*3.)));',
    '      }',
    '      ir *= 0.60 + 0.80*smoothstep(1.0, 0.1, length(q2 - vec2(0.38, -0.42)));',
    '      ir *= mix(1., 0.30, smoothstep(0.84, 1.0, s));',
    '      if (uOptics > 0.5) {',
    '        float blades = smoothstep(0.035, 0.0, abs(fract(a*12./(2.*PI) + s*0.9) - 0.5) - 0.44)*smoothstep(0.05, 0.25, s)*smoothstep(0.75, 0.5, s);',
    '        ir *= 1. - 0.22*blades;',
    '        ir += lin(vec3(0.95, 0.78, 0.40))*smoothstep(0.03, 0.0, abs(s - 0.06))*0.55;',
    '        ir += lin(vec3(0.95, 0.78, 0.40))*smoothstep(0.02, 0.0, abs(s - 0.80))*0.18;',
    '      }',
    '      ir = mix(vec3(0.0015), ir, smoothstep(pr - 0.012, pr + 0.012, r));',
    '      ir *= 0.55 + 0.6*clamp(dot(nc, L)*0.5 + 0.5, 0., 1.);',
    '      vec3 under = mix(ir, scl*0.55, smoothstep(0.985, 1.03, r));',
    '      float F = 0.025 + 0.975*pow(1. - max(dot(-rd, nc), 0.), 5.);',
    '      vec3 rc = reflect(rd, nc);',
    '      ccol = under*(1. - F) + F*env(rc, day) + pow(max(dot(rc, L), 0.), 1400.)*60.*vec3(1., .97, .9);',
    '    }',
    '  }',
    '  vec3 ball = mix(surf, ccol, cm);',
    '  float ao = mix(0.12, 1.0, pow(smoothstep(0.0, 0.30, dU), 0.8))*mix(0.45, 1.0, smoothstep(0.0, 0.08, dL));',
    '  ao *= mix(0.50, 1.0, smoothstep(1.0, 0.55, abs(xl)));',
    '  ball *= ao;',
    '  float men = smoothstep(0.03, 0.010, dL)*smoothstep(0.0, 0.006, dL)*k;',
    '  ball += lin(vec3(0.95,0.93,0.90))*men*mix(0.10, 0.18, day)*(0.6 + 0.4*sin(xl*9. + seed));',
    '  float car = smoothstep(0.09, 0.015, length((vec2(xl, p.y) - vec2(-0.93, -0.135))*vec2(1.0, 1.5)));',
    '  ball = mix(ball, lin(uLidInner)*(0.35 + 0.35*diff), car*0.6);',
    '  return vec4(ball*inside, inside);',
    '}',
    'vec4 lashes(vec2 p, float side, vec4 A, float gy, float seed){',
    '  float xl = p.x*side;',
    '  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);',
    '  float aboveU = p.y - up, belowL = lo - p.y;',
    '  vec3 ink = lin(mix(uBrowCol, vec3(0.008, 0.010, 0.024), 0.55));',
    '  float edgeMask = smoothstep(1.03, 0.80, abs(xl));',
    '  float lashLine = smoothstep(0.020 + 0.016*k, 0.004, abs(aboveU - 0.006))*edgeMask;',
    '  float ls = 0.;',
    '  float Lmax = (0.07 + 0.17*smoothstep(-0.9, 1., t))*(0.35 + 0.65*k)*mix(1., 0.8, A.y);',
    '  if (aboveU > -0.01 && aboveU < 0.30 && abs(xl) < 1.08) {',
    '    for (int j = 0; j < 4; j++) {',
    '      float fj = float(j);',
    '      float h = clamp(aboveU/Lmax, 0., 1.);',
    '      float curl = (0.06 + 0.30*smoothstep(-0.5, 1., t))*h*h + 0.05*h;',
    '      float dens = 17. + fj*4.;',
    '      float coord = (xl - curl)*dens + fj*0.29 + seed*0.7;',
    '      float id = floor(coord);',
    '      float rnd = hash21(vec2(id, fj + seed));',
    '      float len = Lmax*(0.62 + 0.38*rnd);',
    '      float hh = clamp(aboveU/len, 0., 1.);',
    '      float aa = clamp(dens/uScale*1.2, 0.01, 0.5);',
    '      float wdt = mix(0.22, 0.05, hh);',
    '      float off = (rnd - 0.5)*0.25;',
    '      float strand = smoothstep(wdt + aa, max(wdt*0.35 - aa, 0.), abs(fract(coord) - 0.5 - off))*(1. - smoothstep(0.80, 1.0, hh))*step(0., aboveU + 0.005);',
    '      strand = mix(strand, 0.4*(1. - hh), smoothstep(0.25, 0.5, aa));',
    '      ls = max(ls, strand*(1.0 - fj*0.16));',
    '    }',
    '    ls *= edgeMask;',
    '  }',
    '  float lower = 0.;',
    '  if (belowL > 0.022 && belowL < 0.09 && abs(xl) < 1.0) {',
    '    float hh = (belowL - 0.022)/0.065;',
    '    float coord = (xl + 0.03*hh)*15. + seed*1.7;',
    '    lower = smoothstep(mix(0.14, 0.04, hh), 0.02, abs(fract(coord) - 0.5))*(1. - hh)*smoothstep(-0.2, 0.5, t)*k*0.55;',
    '  }',
    '  float a = clamp(max(lashLine, max(ls, lower)), 0., 1.);',
    '  return vec4(ink*a, a);',
    '}',
    'vec4 margin(vec2 p, float side, vec4 A, float gy){',
    '  float xl = p.x*side;',
    '  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);',
    '  float belowL = lo - p.y;',
    '  float m = smoothstep(0.0, 0.008, belowL)*smoothstep(0.034, 0.016, belowL)*k;',
    '  vec3 c = lin(uLidInner)*0.55 + vec3(0.06)*smoothstep(0.02, 0.012, belowL);',
    '  return vec4(c*m, m);',
    '}',
    'vec4 brow(vec2 p, float side, vec4 B){',
    '  float xl = p.x*side;',
    '  float s = (xl + 1.02)/2.0;',
    '  if (s < -0.06 || s > 1.06) return vec4(0.);',
    '  float yb = browY(xl, B);',
    '  float sc = clamp(s, 0., 1.);',
    '  float th = mix(0.135, 0.028, pow(sc, 0.9));',
    '  float dy = p.y - yb + 0.012*sin(xl*7. + side);',
    '  float edge = 0.018 + 0.02*noise(vec2(xl*14., p.y*9.));',
    '  float shape = smoothstep(th*0.5 + edge, th*0.5 - 0.01, abs(dy))*smoothstep(-0.05, 0.05, s)*smoothstep(1.04, 0.90, s);',
    '  if (shape <= 0.001) return vec4(0.);',
    '  float ang = mix(1.30, 0.16, smoothstep(0.02, 0.42, sc)) - 0.25*B.w*(1. - sc) + 0.2*B.x*(1. - sc)*0.5;',
    '  float angs = ang + 0.25*(dy/th);',
    '  vec2 dir = vec2(cos(angs), sin(angs));',
    '  vec2 nrm = vec2(-dir.y, dir.x);',
    '  vec2 lp = vec2(xl, p.y);',
    '  float a = 0.;',
    '  for (int j = 0; j < 4; j++) {',
    '    float fj = float(j);',
    '    float dens = (30. + fj*6.) * mix(1.25, 0.85, sc);',
    '    float u = dot(lp, nrm)*dens + fj*0.37 + 1.1*noise(vec2(dot(lp, dir)*9., fj*3.1)) + 0.5*noise(lp*vec2(31., 23.) + fj);',
    '    float id = floor(u);',
    '    float hh = hash21(vec2(id, fj + side));',
    '    float v = dot(lp, dir)*(7. + 5.*hh) + hh*5.3 + 0.3*noise(vec2(id*0.37, fj));',
    '    float seg = fract(v);',
    '    float along = smoothstep(0.0, 0.10, seg)*smoothstep(0.92, 0.55, seg);',
    '    float wdt = mix(0.40, 0.10, seg);',
    '    float aa = clamp(dens/uScale*1.4, 0.02, 0.5);',
    '    float strand = smoothstep(wdt + aa, max(wdt*0.25 - aa, 0.), abs(fract(u) - 0.5))*along;',
    '    strand = mix(strand, 0.45*along, smoothstep(0.25, 0.5, aa));',
    '    a = max(a, strand*(1.0 - fj*0.14));',
    '  }',
    '  a *= shape;',
    '  a = max(a, shape*mix(0.45, 0.20, sc))*0.97;',
    '  vec3 base = lin(mix(uBrowCol, uSkin*0.55, uDay*0.35));',
    '  vec3 L = normalize(vec3(-0.45, 0.65, 0.62));',
    '  float sheen = pow(clamp(abs(dot(vec3(dir, 0.), L)), 0., 1.), 6.);',
    '  vec3 col = base*(0.55 + 0.30*noise(lp*40.)) + lin(uSSS)*sheen*0.10;',
    '  return vec4(col*a, a);',
    '}',

    'void main(){',
    '  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);',
    '  vec2 q = vec2(frag.x - uMid.x, uMid.y - frag.y)/uScale;',
    '  float lpx = 1.0/uScale;',
    '  bool leftSide = q.x < 0.;',
    '  vec2 p = q - vec2(leftSide ? -uSep : uSep, 0.);',
    '  float side = leftSide ? -1. : 1.;',
    '  vec4 A = leftSide ? uA0 : uA1; vec4 B = leftSide ? uB0 : uB1;',
    '  vec2 gz = leftSide ? uGaze.xy : uGaze.zw;',
    '  float pupil = leftSide ? uPupil.x : uPupil.y;',
    '  float seed = leftSide ? 1.3 : 5.0;',
    '  // skin alpha from both eyes (they overlap near the bridge) and global folds',
    '  float sa = max(eyeSkinAlpha(q - vec2(-uSep, 0.), -1., uA0, uB0, uGaze.y, uC.w), eyeSkinAlpha(q - vec2(uSep, 0.), 1., uA1, uB1, uGaze.w, uC.w));',
    '  sa = max(sa, globalAlpha(q));',
    '  vec3 col = vec3(0.); float alpha = 0.;',
    '  if (sa > 0.004) { col = shadeSkin(q, sa)*sa; alpha = sa; }',
    '  vec4 m = margin(p, side, A, gz.y);',
    '  col = m.rgb + col*(1. - m.a); alpha = m.a + alpha*(1. - m.a);',
    '  float inside, dU, dL;',
    '  vec4 eb = eyeball(p, side, lpx, gz, A, pupil, seed, inside, dU, dL);',
    '  col = eb.rgb + col*(1. - eb.a); alpha = eb.a + alpha*(1. - eb.a);',
    '  vec4 ls = lashes(p, side, A, gz.y, seed);',
    '  col = ls.rgb + col*(1. - ls.a); alpha = ls.a + alpha*(1. - ls.a);',
    '  vec4 br = brow(p, side, B);',
    '  col = br.rgb + col*(1. - br.a); alpha = br.a + alpha*(1. - br.a);',
    '  if (alpha < 1e-4) { outColor = vec4(0.); return; }',
    '  vec3 c = col/alpha;',
    '  vec3 over = max(c - 0.75, 0.);',
    '  c = min(c, 0.75) + 0.25*(1. - exp(-over/0.25));',
    '  outColor = vec4(pow(c, vec3(1./2.2))*alpha, alpha);',
    '}'
  ].join('\n');
  var VERT = '#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';

  // Expression presets (Action Units, 0..1): A = open, blink(handled live), lowerRaise, crow;
  // B = innerBrow, outerBrow, browLower, pinch; C = glabella, nasal, forehead, underEye.
  var PRESETS = {
    calm:      { A: [0.86, 0, 0.05, 0.00], B: [0.00, 0.00, 0.00, 0.00], C: [0.00, 0.00, 0.00, 0.05], pupil: 0.36 },
    attention: { A: [1.00, 0, 0.00, 0.00], B: [0.25, 0.30, 0.00, 0.00], C: [0.00, 0.00, 0.20, 0.00], pupil: 0.42 },
    joy:       { A: [0.74, 0, 0.75, 0.95], B: [0.10, 0.00, 0.12, 0.00], C: [0.00, 0.00, 0.00, 0.75], pupil: 0.40 },
    surprise:  { A: [1.22, 0, 0.00, 0.00], B: [0.95, 0.95, 0.00, 0.00], C: [0.00, 0.00, 0.95, 0.00], pupil: 0.44 },
    empathy:   { A: [0.80, 0, 0.10, 0.00], B: [0.85, -0.25, 0.00, 0.35], C: [0.35, 0.00, 0.45, 0.20], pupil: 0.40, gy: -0.12 },
    thinking:  { A: [0.78, 0, 0.35, 0.15], B: [0.00, 0.10, 0.45, 0.60], C: [0.80, 0.00, 0.00, 0.15], pupil: 0.33, gx: -0.35, gy: 0.30 },
    strict:    { A: [1.02, 0, 0.45, 0.10], B: [0.00, 0.00, 0.95, 0.95], C: [1.00, 0.60, 0.00, 0.30], pupil: 0.30 },
    doubt:     { A: [0.84, 0, 0.30, 0.20], B: [0.00, 0.00, 0.30, 0.20], C: [0.35, 0.00, 0.20, 0.10], pupil: 0.34,
                 right: { A: [0.95, 0, 0.05, 0.00], B: [0.30, 0.85, 0.00, 0.00] } },
    tenderness:{ A: [0.70, 0, 0.45, 0.45], B: [0.25, 0.00, 0.00, 0.00], C: [0.00, 0.00, 0.00, 0.40], pupil: 0.47 },
    sleepy:    { A: [0.42, 0, 0.10, 0.00], B: [0.00, 0.00, 0.10, 0.00], C: [0.00, 0.00, 0.00, 0.30], pupil: 0.38, gy: -0.10 }
  };
  var SKINS = {
    night:  { skin: [0.16, 0.21, 0.44], sss: [0.34, 0.48, 0.92], brow: [0.020, 0.024, 0.070], inner: [0.52, 0.38, 0.58] },
    violet: { skin: [0.29, 0.22, 0.50], sss: [0.62, 0.46, 0.94], brow: [0.045, 0.025, 0.080], inner: [0.62, 0.38, 0.58] },
    indigo: { skin: [0.20, 0.19, 0.42], sss: [0.46, 0.42, 0.90], brow: [0.025, 0.022, 0.065], inner: [0.56, 0.36, 0.58] },
    cobalt: { skin: [0.12, 0.27, 0.52], sss: [0.28, 0.62, 0.96], brow: [0.015, 0.035, 0.080], inner: [0.48, 0.42, 0.64] },
    moon:   { skin: [0.44, 0.50, 0.66], sss: [0.72, 0.80, 0.98], brow: [0.10, 0.11, 0.19], inner: [0.70, 0.50, 0.64] }
  };

  function create(canvas, opts) {
    var gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return null;
    function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var U = {};
    ['uRes', 'uMid', 'uScale', 'uSep', 'uGaze', 'uA0', 'uA1', 'uB0', 'uB1', 'uC', 'uPupil', 'uSkin', 'uSSS', 'uBrowCol', 'uLidInner', 'uDay', 'uOptics', 'uHasIris', 'uIris']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var hasIris = 0;
    var img = new Image();
    img.onload = function () {
      var tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      hasIris = 1; kick();
    };
    img.src = opts.iris || 'iris.jpg';

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cur = { A0: PRESETS.calm.A.slice(), A1: PRESETS.calm.A.slice(), B0: PRESETS.calm.B.slice(), B1: PRESETS.calm.B.slice(), C: PRESETS.calm.C.slice(), pupil: 0.36 };
    var tgt = JSON.parse(JSON.stringify(cur));
    var st = { gx: 0, gy: 0, tx: 0, ty: 0, egx: 0, egy: 0, blink: 0, blinkStart: -1, nextBlink: performance.now() + 1500, double: false,
      lastPointer: -1e9, nextGlance: 0, skin: SKINS.night, day: 0, optics: 0, frozen: false, emotion: 'calm', blinkSlow: false };

    function setEmotion(name) {
      var p = PRESETS[name]; if (!p) return;
      st.emotion = name;
      tgt.A0 = p.A.slice(); tgt.A1 = (p.right ? p.right.A : p.A).slice();
      tgt.B0 = p.B.slice(); tgt.B1 = (p.right ? p.right.B : p.B).slice();
      tgt.C = p.C.slice(); tgt.pupil = p.pupil;
      st.egx = p.gx || 0; st.egy = p.gy || 0;
      st.blinkSlow = name === 'sleepy';
      if (st.blinkStart < 0 && !reduce) st.nextBlink = Math.min(st.nextBlink, performance.now() + 380);
      kick();
    }
    function aim(x, y) {
      var r = canvas.getBoundingClientRect();
      var dx = (x - (r.left + r.width / 2)) / (r.height * 1.4), dy = -(y - (r.top + r.height * 0.62)) / (r.height * 1.4);
      var m = Math.hypot(dx, dy), lim = 0.9;
      st.tx = m > lim ? dx / m * lim : dx; st.ty = (m > lim ? dy / m * lim : dy) * 0.85;
      st.lastPointer = performance.now();
    }
    window.addEventListener('pointermove', function (e) { aim(e.clientX, e.clientY); kick(); }, { passive: true });
    window.addEventListener('pointerdown', function (e) { aim(e.clientX, e.clientY); kick(); }, { passive: true });

    function approach(a, b, k) { for (var i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * k; }
    function blinkCurve(ms, slow) {
      var c = slow ? 190 : 85, h = slow ? 90 : 35, o = slow ? 420 : 190;
      if (ms < c) { var x = ms / c; return x * x; }
      if (ms < c + h) return 1;
      if (ms < c + h + o) { var y = (ms - c - h) / o; return Math.pow(1 - y, 3); }
      return -1;
    }
    function step(now, dt) {
      if (st.frozen) return;
      var kExp = 1 - Math.exp(-dt / 170), kBrow = 1 - Math.exp(-dt / 120), kWr = 1 - Math.exp(-dt / 240);
      approach(cur.A0, tgt.A0, kExp); approach(cur.A1, tgt.A1, kExp);
      approach(cur.B0, tgt.B0, kBrow); approach(cur.B1, tgt.B1, kBrow);
      approach(cur.C, tgt.C, kWr);
      cur.pupil += (tgt.pupil - cur.pupil) * (1 - Math.exp(-dt / 500));
      var idle = now - st.lastPointer > 2600;
      if (!reduce && idle && now > st.nextGlance) {
        var back = Math.random() < 0.5;
        st.tx = back ? 0 : (Math.random() - 0.5) * 0.8; st.ty = back ? 0 : (Math.random() - 0.5) * 0.4;
        st.nextGlance = now + 1300 + Math.random() * 2400;
      }
      var tx = st.tx + st.egx, ty = st.ty + st.egy;
      var dist = Math.hypot(tx - st.gx, ty - st.gy);
      var k = 1 - Math.exp(-dt / (reduce ? 260 : (dist > 0.12 ? 28 : 140)));
      st.gx += (tx - st.gx) * k; st.gy += (ty - st.gy) * k;
      if (reduce) { st.blink = 0; return; }
      if (st.blinkStart < 0 && now > st.nextBlink) st.blinkStart = now;
      if (st.blinkStart >= 0) {
        var b = blinkCurve(now - st.blinkStart, st.blinkSlow);
        if (b < 0) {
          st.blink = 0; st.blinkStart = -1;
          if (!st.double && Math.random() < 0.18) { st.double = true; st.nextBlink = now + 140; }
          else { st.double = false; st.nextBlink = now + (st.blinkSlow ? 1600 : 2400) + Math.random() * 4000; }
        } else st.blink = b;
      }
    }
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
    }
    function draw() {
      resize();
      var w = canvas.width, h = canvas.height;
      var scale = Math.min(h / 3.05, w / 6.0);
      var conv = 0.035;
      gl.uniform2f(U.uRes, w, h);
      gl.uniform2f(U.uMid, w / 2, h * 0.62);
      gl.uniform1f(U.uScale, scale);
      gl.uniform1f(U.uSep, 1.38);
      gl.uniform4f(U.uGaze, st.gx + conv, st.gy, st.gx - conv, st.gy);
      var a0 = cur.A0.slice(), a1 = cur.A1.slice(); a0[1] = st.blink; a1[1] = st.blink;
      gl.uniform4fv(U.uA0, a0); gl.uniform4fv(U.uA1, a1);
      gl.uniform4fv(U.uB0, cur.B0); gl.uniform4fv(U.uB1, cur.B1);
      gl.uniform4fv(U.uC, cur.C);
      gl.uniform2f(U.uPupil, cur.pupil, cur.pupil);
      gl.uniform3fv(U.uSkin, st.skin.skin); gl.uniform3fv(U.uSSS, st.skin.sss);
      gl.uniform3fv(U.uBrowCol, st.skin.brow); gl.uniform3fv(U.uLidInner, st.skin.inner);
      gl.uniform1f(U.uDay, st.day); gl.uniform1f(U.uOptics, st.optics);
      gl.uniform1f(U.uHasIris, hasIris); gl.uniform1i(U.uIris, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    var raf = 0, last = performance.now(), visible = true;
    function frame(now) {
      raf = 0;
      var dt = Math.min(64, now - last); last = now;
      step(now, dt); draw();
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) kick(); }).observe(canvas);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
    kick();

    return {
      setEmotion: setEmotion,
      setSkin: function (name) { if (SKINS[name]) { st.skin = SKINS[name]; kick(); } },
      setDay: function (v) { st.day = v ? 1 : 0; kick(); },
      setOptics: function (v) { st.optics = v ? 1 : 0; kick(); },
      blink: function () { if (st.blinkStart < 0) st.blinkStart = performance.now(); kick(); },
      emotions: Object.keys(PRESETS),
      // Deterministic still frames for automated review.
      pose: function (name, gx, gy, blink) {
        setEmotion(name);
        cur = JSON.parse(JSON.stringify(tgt));
        st.frozen = true; st.gx = gx || 0; st.gy = gy || 0; st.blink = blink || 0; draw();
      },
      ready: function () { return hasIris === 1; }
    };
  }
  window.VijuEyeLab = { create: create, PRESETS: PRESETS, SKINS: SKINS };
})();
