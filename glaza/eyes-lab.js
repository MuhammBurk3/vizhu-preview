// Вижу · лаборатория глаз, версия 2.
// Один фрагментный шейдер WebGL2. Глазное яблоко с преломлением в роговице,
// лицо с анатомическими пропорциями (межглазье = ширина глаза, брови на своей
// высоте), кожа с объёмом и складками по мимическим мышцам, брови из отдельных
// волосков, ресницы из отдельных изогнутых ресничек.
(function () {
  'use strict';

  var FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform vec2 uMid; uniform float uScale; uniform float uSep;
uniform vec4 uGaze;
uniform vec4 uA0, uA1;   // open, blink, lowerRaise (cheek + lower lid), crow's feet
uniform vec4 uB0, uB1;   // innerBrow raise, outerBrow raise, brow lower, corrugator pinch
uniform vec4 uC;         // glabella lines, nasal root lines, forehead lines, under-eye
uniform vec2 uPupil;
uniform vec3 uSkin, uSSS, uSheen, uBrowCol, uLidInner;
uniform float uDay, uOptics, uHasIris, uPresence;
uniform sampler2D uIris;
out vec4 outColor;
const float PI = 3.14159265;

float hash21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz)*p3.zy); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a*noise(p); p = p*2.03 + 7.1; a *= .5; } return s; }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
float pores(vec2 p){ vec2 i = floor(p), f = fract(p); float md = 1.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(x, y); vec2 r = g + hash22(i + g) - f; md = min(md, dot(r, r)); }
  return sqrt(md); }
// A skin fold: a soft valley with slightly raised shoulders on both sides.
float fold(float d, float w){ return -exp(-(d*d)/(w*w)) + 0.10*exp(-pow((abs(d) - 1.7*w)/(0.9*w), 2.)); }

// ---------------- eyelids ----------------
void lidCurves(float xl, vec4 A, float gy, out float up, out float lo, out float k, out float t){
  t = clamp(xl, -1., 1.);
  k = max(1. - t*t, 0.);
  float base = mix(-0.17, -0.075, (t + 1.)*.5);
  up = base + (0.445*A.x)*pow(k, 0.80)*(1. - 0.10*t) + gy*0.13*k;
  lo = base - (0.275 - 0.09*A.z)*pow(k, 1.10)*(1. + 0.16*t) + gy*0.05*k + A.z*0.03*k;
  float meet = lo + 0.03*k;
  up = mix(up, meet, A.y);
  lo = mix(lo, meet - 0.004, A.y*0.12);
}

// ---------------- brows ----------------
float browS(float xl, vec4 B){ float xh = -1.05 - 0.10*B.w; float xt = 1.36 - 0.03*B.w; return (xl - xh)/(xt - xh); }
float browC(float s, vec4 B){
  float sc = clamp(s, 0., 1.);
  float y = 1.30 + 0.19*sin(PI*pow(sc, 0.85)) - 0.13*pow(max(sc - 0.62, 0.)/0.38, 1.6);
  y += 0.30*B.x*pow(1. - sc, 1.6);
  y += 0.26*B.y*pow(sc, 1.2);
  y -= 0.24*B.z*(1. - 0.45*sc);
  y -= 0.10*B.w*pow(1. - sc, 2.);
  return y;
}
float browTh(float s){ float sc = clamp(s, 0., 1.); return mix(0.40, 0.085, smoothstep(0.10, 1.0, sc))*mix(0.78, 1.0, smoothstep(-0.05, 0.12, s)); }
float browTangent(float s, vec4 B){ float xh = -1.05 - 0.10*B.w, xt = 1.36 - 0.03*B.w; float e = 0.02;
  return atan((browC(s + e, B) - browC(s - e, B))/(2.*e*(xt - xh))); }
float browAngle(float s, float dn, vec4 B){
  float sc = clamp(s, 0., 1.);
  float head = 1.45 + 0.35*B.x - 0.30*B.w;
  float body = browTangent(sc, B) + 0.22 + mix(0.24, -0.26, dn*0.5 + 0.5);
  return mix(head, body, smoothstep(0.04, 0.32, sc));
}

// ---------------- skin form ----------------
float eyeForm(vec2 p, float side, vec4 A, vec4 B, float gy, float ue){
  float xl = p.x*side;
  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);
  float aboveU = p.y - up, belowL = lo - p.y;
  float spanU = smoothstep(1.15, 0.6, abs(xl));
  float h = 0.12*exp(-dot(p*vec2(0.85, 1.0), p*vec2(0.85, 1.0))/0.9);
  float cr = 0.20 + 0.06*(1. - clamp(A.x, 0., 1.3));
  h += 0.030*smoothstep(0.0, 0.06, aboveU)*smoothstep(cr + 0.02, cr - 0.04, aboveU)*spanU;
  h += 0.010*exp(-pow((aboveU - cr - 0.06)/0.08, 2.))*spanU;
  h -= 0.018*exp(-pow((aboveU - cr + 0.005)/0.03, 2.))*spanU;
  float bs = browS(xl, B); float yb = browC(bs, B);
  h -= 0.028*exp(-pow((p.y - mix(up + cr + 0.10, yb - 0.22, 0.5))/0.30, 2.))*smoothstep(1.3, 0.4, abs(xl - 0.05));
  h += 0.07*exp(-pow((p.y - (yb - 0.02))/0.34, 2.))*smoothstep(1.9, 0.6, abs(xl - 0.1));
  h += (0.016 + 0.05*A.z)*exp(-pow((belowL - 0.07)/0.05, 2.))*smoothstep(1.05, 0.6, abs(xl));
  float yj = 0.23 - 0.05*A.z;
  h -= (0.016 + 0.02*ue)*exp(-pow((belowL - yj)/0.055, 2.))*smoothstep(1.1, 0.2, abs(xl + 0.1));
  h += (0.06 + 0.11*A.z)*exp(-pow((belowL - 0.47 + 0.07*A.z)/0.26, 2.))*smoothstep(1.7, 0.3, abs(xl - 0.15));
  // crow's feet: radial creases fanning from beyond the outer corner, bending down with the cheek
  if (A.w > 0.01) {
    vec2 d = vec2(xl, p.y) - vec2(1.02, -0.06);
    float r = length(d);
    if (r < 0.78 && d.x > -0.28) {
      float th = atan(d.y, d.x);
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float a0 = mix(-0.60, 0.46, fi/3.) + 0.05*sin(fi*2.7);
        float dth = th - (a0 - 0.30*r*(0.8 - fi*0.25));
        float wid = 0.050 + 0.035*r;
        float along = smoothstep(0.15, 0.28, r)*smoothstep(0.70 - 0.07*abs(fi - 1.5), 0.36, r);
        h += A.w*along*0.030*(0.75 + 0.25*noise(vec2(r*6., fi*3.)))*fold(r*dth, wid);
      }
    }
  }
  if (A.z > 0.01) {
    h += A.z*0.016*fold(belowL - yj*0.60, 0.034)*smoothstep(0.95, 0.25, abs(xl - 0.3));
    h += A.z*0.009*fold(belowL - yj*0.95, 0.03)*smoothstep(0.7, 0.2, abs(xl - 0.5));
  }
  return h;
}
float innerBrowY(){ return 0.5*(browC(0., uB0) + browC(0., uB1)); }
float globalForm(vec2 q){
  float yI = innerBrowY();
  float h = 0.10*exp(-pow(q.x/0.45, 2.))*smoothstep(1.0, 0.1, q.y);
  h += 0.05*smoothstep(yI, yI + 0.6, q.y);
  float g = uC.x;
  if (g > 0.01) {
    for (int si = 0; si < 2; si++) {
      float sg = si == 0 ? -1. : 1.;
      float xw = q.x - sg*(0.21 - 0.05*g) - sg*0.08*(q.y - yI);
      float along = smoothstep(yI - 0.55, yI - 0.28, q.y)*smoothstep(yI + 0.36, yI + 0.04, q.y);
      h += g*0.034*fold(xw, 0.060)*along;

    }
    h += g*0.030*exp(-pow(q.x/0.12, 2.) - pow((q.y - yI + 0.10)/0.26, 2.));
  }
  if (uC.y > 0.01) {
    for (int j = 0; j < 1; j++) {
      float yj = yI - 0.64 - float(j)*0.09;
      h += uC.y*0.015*fold(q.y - yj - 0.02*sin(q.x*6.), 0.040)*smoothstep(0.36, 0.08, abs(q.x));
    }
  }
  if (uC.z > 0.01) {
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      float ax = abs(q.x);
      float arch = 0.10*exp(-pow((ax - uSep*0.72)/0.95, 2.));
      float yj = yI + 0.30 + fj*0.14 + arch + 0.015*sin(q.x*3.1 + fj*1.7);
      float spanF = (exp(-pow((ax - uSep*0.78)/0.95, 2.)) + 0.35*uB0.x*exp(-pow(ax/0.45, 2.)))*smoothstep(0.25, 0.65, noise(vec2(q.x*2.2 + fj*5., fj*3.)) + 0.25);
      h += uC.z*0.020*fold(q.y - yj, 0.050)*spanF;
    }
  }
  return h;
}
float totalH(vec2 q){
  float h = globalForm(q);
  h += eyeForm(q - vec2(-uSep, 0.), -1., uA0, uB0, uGaze.y, uC.w);
  h += eyeForm(q - vec2( uSep, 0.),  1., uA1, uB1, uGaze.w, uC.w);
  h += 0.00016*(1. - pores(q*80.)) + 0.00008*noise(q*200.);
  return h;
}
float presence(vec2 q){
  float m = 0.; float keep = 1.;
  for (int e = 0; e < 2; e++) {
    float cx = e == 0 ? -uSep : uSep;
    vec2 d = (q - vec2(cx*0.96, 0.72))/vec2(2.05, 1.95);
    keep *= 1. - exp(-pow(length(d), 2.2)*1.45);
  }
  keep *= 1. - 0.9*exp(-pow(q.x/1.3, 2.) - pow((q.y - 0.95)/1.45, 2.));
  return 1. - keep;
}
// Where expressions fold the skin, it shows up even in the minimal skin mode.
float expressionReveal(vec2 q){
  float r = 0.;
  for (int e = 0; e < 2; e++) {
    float sd = e == 0 ? -1. : 1.;
    vec4 A = e == 0 ? uA0 : uA1; vec4 B = e == 0 ? uB0 : uB1;
    vec2 p = q - vec2(sd*uSep, 0.); float xl = p.x*sd;
    float up, lo, k, t; lidCurves(xl, A, 0., up, lo, k, t);
    float near = exp(-max(max(p.y - up, lo - p.y), 0.)/0.14)*smoothstep(1.35, 0.95, abs(xl));
    float bs = browS(xl, B);
    float brow = 0.75*exp(-pow((p.y - browC(bs, B))/0.32, 2.))*smoothstep(-0.25, 0.05, bs)*smoothstep(1.2, 0.95, bs);
    vec2 d = vec2(xl, p.y) - vec2(1.02, -0.06);
    float crow = A.w*smoothstep(0.75, 0.15, length(d*vec2(0.9, 1.1)))*smoothstep(-0.4, 0.05, d.x);
    float under = max(uC.w, A.z)*exp(-pow((lo - p.y - 0.25)/0.2, 2.))*smoothstep(1.25, 0.35, abs(xl - 0.1));
    r = max(r, max(max(near, brow), max(crow, under)));
  }
  float yI = innerBrowY();
  r = max(r, uC.x*exp(-pow(q.x/0.45, 2.) - pow((q.y - yI + 0.1)/0.45, 2.)));
  r = max(r, uC.y*exp(-pow(q.x/0.4, 2.) - pow((q.y - yI + 0.68)/0.2, 2.)));
  r = max(r, uC.z*0.9*exp(-pow((abs(q.x) - uSep*0.7)/1.3, 2.) - pow((q.y - yI - 0.46)/0.35, 2.)));
  return r;
}

// ---------------- lighting ----------------
vec3 env(vec3 d, float day){
  vec3 sky = mix(vec3(0.004, 0.006, 0.02), vec3(0.18, 0.16, 0.14), day);
  vec2 w = vec2(d.x + 0.42, d.y - 0.46);
  float rr = length(max(abs(w) - vec2(0.085, 0.060), 0.)) - 0.05;
  vec3 c = sky + vec3(1.0, 0.97, 0.92)*smoothstep(0.035, -0.025, rr)*20.;
  vec2 gd = d.xy - vec2(0.56, -0.34);
  return c + lin(vec3(0.91, 0.74, 0.33))*exp(-60.*dot(gd, gd))*3.0;
}
float lashShade(vec2 q){
  float o = 1.;
  for (int e = 0; e < 2; e++) {
    float sd = e == 0 ? -1. : 1.;
    vec4 A = e == 0 ? uA0 : uA1; vec4 B = e == 0 ? uB0 : uB1;
    vec2 p = q - vec2(sd*uSep, 0.); float xl = p.x*sd;
    float up, lo, k, t; lidCurves(xl, A, 0., up, lo, k, t);
    float aboveU = p.y - up;
    float span = smoothstep(1.12, 0.8, abs(xl));
    o *= 1. - 0.62*span*smoothstep(-0.01, 0.01, aboveU)*smoothstep(0.13, 0.0, aboveU);
    float bs = browS(xl, B); float dn = (p.y - browC(bs, B))/(browTh(bs)*0.5);
    o *= 1. - 0.30*smoothstep(1.3, 0.3, abs(dn))*smoothstep(-0.1, 0.1, bs)*smoothstep(1.1, 0.9, bs);
  }
  return o;
}
vec3 shadeSkin(vec2 q, float pres){
  float e = 1.1/uScale;
  float h0 = totalH(q);
  float hxp = totalH(q + vec2(e, 0.)), hxm = totalH(q - vec2(e, 0.));
  float hyp = totalH(q + vec2(0., e)), hym = totalH(q - vec2(0., e));
  vec3 N = normalize(vec3(-(hxp - hxm)/(2.*e), -(hyp - hym)/(2.*e), 1.));
  float lap = (hxp + hxm + hyp + hym - 4.*h0)/(e*e);
  float cavity = clamp(lap*0.022, -0.30, 0.55);
  vec3 V = vec3(0., 0., 1.);
  vec3 albedo = lin(mix(uSkin, vec3(0.93, 0.95, 1.0), uDay*0.70));
  float periKeep = 1.;
  for (int e = 0; e < 2; e++) {
    float sd = e == 0 ? -1. : 1.;
    vec4 A = e == 0 ? uA0 : uA1;
    vec2 pp = q - vec2(sd*uSep, 0.); float xl = pp.x*sd;
    float up, lo, k, t; lidCurves(xl, A, 0., up, lo, k, t);
    float dOut = max(max(pp.y - up, lo - pp.y), 0.) + max(abs(xl) - 1., 0.)*0.8;
    periKeep *= 1. - exp(-dOut/0.22)*smoothstep(1.4, 0.9, abs(xl));
  }
  float peri = 1. - periKeep;
  albedo *= mix(vec3(1.0), vec3(0.80, 0.78, 0.96), peri*(1. - uDay*0.4));
  vec3 sss = lin(mix(uSSS, vec3(1.0), uDay*0.55));
  vec3 L1 = normalize(vec3(-0.38, 0.58, 0.72));
  vec3 L2 = normalize(vec3(0.60, -0.40, 0.70));
  vec3 L3 = normalize(vec3(0.97, 0.10, 0.22));
  float d1 = dot(N, L1);
  float wrap = clamp((d1 + 0.30)/1.30, 0., 1.);
  vec3 col = albedo*wrap*vec3(1.0, 0.97, 0.94);
  col += sss*albedo*pow(clamp(1. - abs(d1 - 0.1), 0., 1.), 3.)*0.55;
  col += albedo*clamp(dot(N, L2)*0.5 + 0.5, 0., 1.)*lin(vec3(0.40, 0.52, 0.95))*0.20;
  col += lin(vec3(0.91, 0.74, 0.33))*pow(clamp(dot(N, L3), 0., 1.), 4.)*0.08*(1. - uDay);
  vec3 H = normalize(L1 + V);
  float spec = pow(clamp(dot(N, H), 0., 1.), 48.);
  col += vec3(1.0, 0.98, 0.95)*spec*0.07;
  col += lin(uSheen)*albedo*pow(1. - clamp(N.z, 0., 1.), 3.)*0.8;
  col *= 1. - cavity*0.9;
  col *= lashShade(q);
  col *= mix(1.35, 1.0, uDay);
  col *= mix(mix(0.03, 0.80, uDay), 1.0, pow(pres, mix(1.5, 0.8, uDay)));
  return col;
}

// ---------------- eyeball ----------------
vec4 eyeball(vec2 p, float side, float lpx, vec2 gz, vec4 A, float pupil, float seed){
  float day = uDay;
  float xl = p.x*side;
  float up, lo, k, t; lidCurves(xl, A, gz.y, up, lo, k, t);
  float dU = up - p.y, dL = p.y - lo;
  float inside = smoothstep(-lpx, lpx, dU)*smoothstep(-lpx, lpx, dL)*smoothstep(1.0 + lpx, 1.0 - lpx, abs(xl));
  if (inside < 0.001) return vec4(0.);
  float Rb = 1.02;
  vec3 g = normalize(vec3(gz.x*0.62, gz.y*0.52, 1.0));
  float cosI = cos(0.385); float Ri = Rb*sin(0.385);
  vec3 ro = vec3(p, 6.), rd = vec3(0, 0, -1);
  vec3 nb = normalize(vec3(p, sqrt(max(Rb*Rb - dot(p, p), 0.0001))));
  vec3 L = normalize(vec3(-0.50, 0.62, 0.70));
  vec3 sc = mix(lin(vec3(0.76, 0.73, 0.70)), lin(vec3(0.95, 0.93, 0.89)), day);
  float corner = smoothstep(0.30, 1.0, abs(xl));
  sc = mix(sc, mix(lin(vec3(0.80, 0.66, 0.66)), lin(uSSS), 0.35), corner*0.55);
  float v = fbm(vec2(xl*7.0 + seed, p.y*11.0));
  sc = mix(sc, lin(vec3(0.70, 0.30, 0.30)), smoothstep(0.016, 0.0, abs(v - 0.5))*corner*0.25);
  float diff = clamp((dot(nb, L) + 0.45)/1.45, 0., 1.);
  vec3 scl = sc*(0.30 + 0.85*diff)*(1. - 0.55*pow(1. - nb.z, 1.6));
  vec3 surf = scl + (0.02 + 0.98*pow(1. - nb.z, 5.))*env(reflect(rd, nb), day)*0.12;
  vec3 Cc = g*(Rb + 0.06 - 0.60);
  vec3 oc = ro - Cc; float b = dot(oc, rd); float c = dot(oc, oc) - 0.36;
  float disc = b*b - c;
  float cm = 0.; vec3 ccol = vec3(0.);
  if (disc > 0.) {
    vec3 Pc = ro + rd*(-b - sqrt(disc));
    cm = smoothstep(-0.004, 0.012, dot(Pc, g) - Rb*cosI);
    if (cm > 0.) {
      vec3 nc = normalize(Pc - Cc);
      vec3 rt = refract(rd, nc, 1.0/1.376);
      vec3 Ip = g*(Rb*cosI - 0.045);
      vec3 Pi = Pc + rt*(dot(Ip - Pc, g)/dot(rt, g));
      vec3 qq = Pi - Ip;
      vec3 u = normalize(cross(vec3(0, 1, 0), g)); vec3 w = cross(g, u);
      vec2 q2 = vec2(dot(qq, u), dot(qq, w))/Ri;
      float r = length(q2); float a = atan(q2.y, q2.x);
      float pr = pupil*(1. + 0.012*sin(a*5. + seed));
      float s = clamp((r - pr)/(1. - pr), 0., 1.);
      vec3 ir;
      if (uHasIris > 0.5) {
        vec2 dir = r > 1e-4 ? q2/r : vec2(0.);
        ir = lin(texture(uIris, 0.5 + vec2(dir.x, -dir.y)*mix(0.37, 1.0, s)*0.47*(side > 0. ? -1. : 1.)).rgb)*1.35;
      } else {
        ir = mix(lin(vec3(0.93, 0.70, 0.30)), lin(vec3(0.62, 0.34, 0.10)), smoothstep(0.1, 0.7, s))*(0.5 + fbm(vec2(a*10., s*3.)));
      }
      ir *= 0.60 + 0.80*smoothstep(1.0, 0.1, length(q2 - vec2(0.38, -0.42)));
      ir *= mix(1., 0.30, smoothstep(0.84, 1.0, s));
      if (uOptics > 0.5) {
        float blades = smoothstep(0.035, 0.0, abs(fract(a*12./(2.*PI) + s*0.9) - 0.5) - 0.44)*smoothstep(0.05, 0.25, s)*smoothstep(0.75, 0.5, s);
        ir *= 1. - 0.22*blades;
        ir += lin(vec3(0.95, 0.78, 0.40))*smoothstep(0.03, 0.0, abs(s - 0.06))*0.55;
        ir += lin(vec3(0.95, 0.78, 0.40))*smoothstep(0.02, 0.0, abs(s - 0.80))*0.18;
      }
      ir = mix(vec3(0.0015), ir, smoothstep(pr - 0.012, pr + 0.012, r));
      ir *= 0.55 + 0.6*clamp(dot(nc, L)*0.5 + 0.5, 0., 1.);
      vec3 under = mix(ir, scl*0.55, smoothstep(0.985, 1.03, r));
      float F = 0.025 + 0.975*pow(1. - max(dot(-rd, nc), 0.), 5.);
      vec3 rc = reflect(rd, nc);
      ccol = under*(1. - F) + F*env(rc, day) + pow(max(dot(rc, L), 0.), 1400.)*60.*vec3(1., .97, .9);
    }
  }
  vec3 ball = mix(surf, ccol, cm);
  float ao = mix(0.10, 1.0, pow(smoothstep(0.0, 0.32, dU), 0.8))*mix(0.45, 1.0, smoothstep(0.0, 0.08, dL));
  ao *= mix(0.50, 1.0, smoothstep(1.0, 0.55, abs(xl)));
  ball *= ao;
  float men = smoothstep(0.03, 0.010, dL)*smoothstep(0.0, 0.006, dL)*k;
  ball += lin(vec3(0.95, 0.93, 0.90))*men*mix(0.10, 0.18, day)*(0.6 + 0.4*sin(xl*9. + seed));
  float car = smoothstep(0.09, 0.015, length((vec2(xl, p.y) - vec2(-0.93, -0.135))*vec2(1.0, 1.5)));
  ball = mix(ball, lin(uLidInner)*(0.35 + 0.35*diff), car*0.6);
  return vec4(ball*inside, inside);
}

// ---------------- lid margins ----------------
vec4 lowerMargin(vec2 p, float side, vec4 A, float gy){
  float xl = p.x*side;
  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);
  float belowL = lo - p.y;
  float m = smoothstep(0.0, 0.007, belowL)*smoothstep(0.038, 0.016, belowL)*k;
  vec3 c = lin(uLidInner)*0.50 + vec3(0.07)*smoothstep(0.022, 0.010, belowL)*smoothstep(0.0, 0.006, belowL);
  return vec4(c*m, m);
}

// ---------------- lashes: individual curved lashes rooted on the lid margin ----------------
vec4 upperLashes(vec2 p, float side, vec4 A, float gy, float seed){
  float xl = p.x*side;
  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);
  if (p.y < up - 0.07 || p.y > up + 0.50 || abs(xl) > 1.55) return vec4(0.);
  vec2 P = vec2(xl, p.y);
  float aa = 0.85/uScale;
  float cov = 0.;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float N = layer == 0 ? 34. : (layer == 1 ? 30. : 42.);
    float lenK = layer == 0 ? 1.0 : (layer == 1 ? 0.78 : 0.42);
    float idx = (xl + 0.94)/1.92*N;
    for (int j = -9; j <= 2; j++) {
      float i = floor(idx) + float(j);
      if (i < 0. || i >= N) continue;
      float h = hash21(vec2(i, seed + fl*13.));
      float h2 = hash21(vec2(i + 31., seed + fl*7.));
      float xr = -0.94 + (i + h)/N*1.92;
      float ur, lr, kr, tr; lidCurves(xr, A, gy, ur, lr, kr, tr);
      float lat = smoothstep(-0.75, 1.0, xr);
      float clumpA = (hash21(vec2(floor(i/4.), seed + fl*3.)) - 0.5)*0.45;
      float ang = mix(1.62, 0.52, pow(lat, 0.9)) + (h2 - 0.5)*0.28 - A.y*1.3;
      float len = mix(0.13, 0.40, smoothstep(-0.9, 0.6, xr))*mix(0.60, 1.10, h2)*(0.55 + 0.45*kr)*lenK;
      float curl = mix(0.25, 1.05, lat)*mix(0.55, 1.0, h) + 0.10;
      vec2 prev = vec2(xr, ur - 0.008);
      float best = 1e3, bt = 0.;
      for (int sg = 1; sg <= 5; sg++) {
        float fs = float(sg)/5.;
        float a = ang + clumpA*fs*fs + curl*pow(fs, 1.6);
        vec2 nxt = prev + vec2(cos(a), sin(a))*len*0.2;
        vec2 pa = P - prev, ba = nxt - prev;
        float hs = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.);
        float d = length(pa - ba*hs);
        if (d < best) { best = d; bt = fs - 0.2 + hs*0.2; }
        prev = nxt;
      }
      float w = mix(0.0135, 0.0012, pow(bt, 0.75));
      float c = smoothstep(w + aa, max(w - aa, 0.), best)*(1. - smoothstep(0.88, 1.0, bt))*(layer == 2 ? 0.85 : 0.95);
      cov = 1. - (1. - cov)*(1. - c);
    }
  }
  float edge = smoothstep(1.06, 0.84, abs(xl));
  float line = smoothstep(0.032 + 0.012*k, 0.008, abs(p.y - up - 0.010))*edge;
  float mass = smoothstep(0.085, 0.0, p.y - up)*step(up - 0.01, p.y)*edge*0.55*k;
  float a = clamp(max(max(cov*edge, line), mass), 0., 1.);
  vec3 ink = lin(mix(uBrowCol, vec3(0.005, 0.006, 0.016), 0.65));
  return vec4(ink*a, a);
}
vec4 lowerLashes(vec2 p, float side, vec4 A, float gy, float seed){
  float xl = p.x*side;
  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);
  if (p.y > lo + 0.02 || p.y < lo - 0.16 || xl < -0.7 || xl > 1.2) return vec4(0.);
  vec2 P = vec2(xl, p.y);
  float N = 26.;
  float idx = (xl + 0.55)/1.5*N;
  float cov = 0.;
  float aa = 0.85/uScale;
  for (int j = -3; j <= 3; j++) {
    float i = floor(idx) + float(j);
    if (i < 0. || i >= N) continue;
    float h = hash21(vec2(i, seed + 11.));
    float xr = -0.55 + (i + 0.5 + (h - 0.5)*0.8)/N*1.5;
    float ur, lr, kr, tr; lidCurves(xr, A, gy, ur, lr, kr, tr);
    float lat = smoothstep(-0.5, 1.0, xr);
    float ang = -1.45 + 0.75*lat + 0.2*(h - 0.5);
    float len = mix(0.045, 0.10, lat)*mix(0.7, 1.1, h)*kr;
    vec2 R = vec2(xr, lr - 0.03);
    vec2 E = R + vec2(cos(ang), sin(ang))*len;
    vec2 pa = P - R, ba = E - R;
    float hs = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.);
    float d = length(pa - ba*hs);
    float w = mix(0.0055, 0.0012, hs);
    cov = max(cov, smoothstep(w + aa, max(w - aa, 0.), d)*(1. - hs*0.5));
  }
  float a = cov*0.55;
  vec3 ink = lin(mix(uBrowCol, vec3(0.01, 0.012, 0.03), 0.5));
  return vec4(ink*a, a);
}

// ---------------- brows: hundreds of individual hairs ----------------
vec4 brow(vec2 p, float side, vec4 B){
  float xl = p.x*side;
  float s = browS(xl, B);
  if (s < -0.18 || s > 1.14) return vec4(0.);
  float yc = browC(s, B);
  if (abs(p.y - yc) > browTh(s)*0.5 + 0.26) return vec4(0.);
  vec2 P = vec2(xl, p.y);
  float cs = 0.040;
  vec2 cell = floor(P/cs);
  float cov = 0.; vec3 acc = vec3(0.);
  float aa = 0.9/uScale;
  vec3 base = lin(mix(uBrowCol*0.7, uSkin*0.55, uDay*0.30));
  for (int dy = -5; dy <= 1; dy++) {
    for (int dx = -6; dx <= 1; dx++) {
      vec2 c = cell + vec2(float(dx), float(dy));
      vec2 hr = hash22(c + side*17.3);
      vec2 R = (c + hr)*cs;
      float sr = browS(R.x, B);
      if (sr < -0.05 || sr > 1.03) continue;
      float ycr = browC(sr, B), thr = browTh(sr);
      float dn = (R.y - ycr)/(thr*0.5);
      if (abs(dn) > 1.0) continue;
      float dens = smoothstep(1.0, 0.55, abs(dn))*smoothstep(-0.05, 0.10, sr)*smoothstep(1.03, 0.85, sr);
      float h3 = hash21(c*1.37 + side);
      if (h3 > 0.50 + 0.50*dens) continue;
      float ang = browAngle(sr, dn, B) + (hr.x - 0.5)*0.30;
      float len = mix(0.15, 0.26, hr.y)*mix(1.0, 0.62, clamp(sr, 0., 1.))*mix(0.7, 1.0, dens);
      float bend = (hash21(c + 5.1) - 0.5)*0.5 - 0.18;
      vec2 prev = R; float best = 1e3, bt = 0.;
      for (int k = 1; k <= 3; k++) {
        float fk = float(k);
        float a = ang + bend*(fk/3.);
        vec2 nxt = prev + vec2(cos(a), sin(a))*len/3.;
        vec2 pa = P - prev, ba = nxt - prev;
        float hs = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.);
        float d = length(pa - ba*hs);
        if (d < best) { best = d; bt = (fk - 1. + hs)/3.; }
        prev = nxt;
      }
      float w = mix(0.0080, 0.0018, bt);
      float cv = smoothstep(w + aa, max(w - aa, 0.), best)*(1. - smoothstep(0.85, 1.0, bt))*0.95;
      vec3 hc = base*mix(0.65, 1.25, hash21(c + 9.7))*mix(0.8, 1.15, bt);
      acc = acc*(1. - cv) + hc*cv;
      cov = cov + cv*(1. - cov);
    }
  }
  acc += lin(uSheen)*0.03*cov;
  return vec4(acc, cov);
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = vec2(frag.x - uMid.x, uMid.y - frag.y)/uScale;
  float lpx = 1.0/uScale;
  bool leftSide = q.x < 0.;
  float side = leftSide ? -1. : 1.;
  vec2 p = q - vec2(side*uSep, 0.);
  vec4 A = leftSide ? uA0 : uA1; vec4 B = leftSide ? uB0 : uB1;
  vec2 gz = leftSide ? uGaze.xy : uGaze.zw;
  float pupil = leftSide ? uPupil.x : uPupil.y;
  float seed = leftSide ? 1.3 : 5.0;

  float pres = presence(q);
  float vis = clamp(max(pres*uPresence, expressionReveal(q)), 0., 1.);
  vec3 col = vec3(0.); float alpha = 0.;
  if (vis > 0.004) { col = shadeSkin(q, pres)*vis; alpha = vis; }
  vec4 m = lowerMargin(p, side, A, gz.y);
  col = m.rgb + col*(1. - m.a); alpha = m.a + alpha*(1. - m.a);
  vec4 eb = eyeball(p, side, lpx, gz, A, pupil, seed);
  col = eb.rgb + col*(1. - eb.a); alpha = eb.a + alpha*(1. - eb.a);
  vec4 ll = lowerLashes(p, side, A, gz.y, seed);
  col = ll.rgb + col*(1. - ll.a); alpha = ll.a + alpha*(1. - ll.a);
  vec4 ul = upperLashes(p, side, A, gz.y, seed);
  col = ul.rgb + col*(1. - ul.a); alpha = ul.a + alpha*(1. - ul.a);
  vec4 br = brow(p, side, B);
  br *= mix(0.80, 1.0, max(pres, uDay));
  col = br.rgb + col*(1. - br.a); alpha = br.a + alpha*(1. - br.a);
  if (alpha < 1e-4) { outColor = vec4(0.); return; }
  vec3 c = col/alpha;
  vec3 over = max(c - 0.75, 0.);
  c = min(c, 0.75) + 0.25*(1. - exp(-over/0.25));
  c = pow(c, vec3(1./2.2));
  c += (hash21(frag + 0.5) - 0.5)/255.;
  outColor = vec4(c*alpha, alpha);
}`;
  var VERT = '#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';

  // Expression presets. A = open, blink (live), lowerRaise, crow's feet;
  // B = inner brow raise, outer brow raise, brow lower, corrugator pinch;
  // C = glabella lines, nasal root lines, forehead lines, under-eye crease.
  var PRESETS = {
    calm:      { A: [0.86, 0, 0.06, 0.00], B: [0.00, 0.00, 0.00, 0.00], C: [0.00, 0.00, 0.00, 0.10], pupil: 0.36 },
    attention: { A: [1.00, 0, 0.00, 0.00], B: [0.28, 0.30, 0.00, 0.00], C: [0.00, 0.00, 0.25, 0.00], pupil: 0.42 },
    joy:       { A: [0.72, 0, 0.80, 1.00], B: [0.12, 0.00, 0.14, 0.00], C: [0.00, 0.00, 0.00, 0.80], pupil: 0.40 },
    surprise:  { A: [1.20, 0, 0.00, 0.00], B: [0.95, 0.90, 0.00, 0.00], C: [0.00, 0.00, 0.95, 0.00], pupil: 0.44 },
    empathy:   { A: [0.80, 0, 0.10, 0.00], B: [0.90, -0.30, 0.00, 0.40], C: [0.40, 0.00, 0.55, 0.25], pupil: 0.41, gy: -0.12 },
    thinking:  { A: [0.78, 0, 0.35, 0.18], B: [0.00, 0.10, 0.45, 0.65], C: [0.80, 0.10, 0.00, 0.20], pupil: 0.33, gx: -0.35, gy: 0.30 },
    strict:    { A: [1.02, 0, 0.45, 0.12], B: [0.00, 0.00, 0.95, 0.95], C: [1.00, 0.70, 0.00, 0.30], pupil: 0.30 },
    doubt:     { A: [0.84, 0, 0.32, 0.22], B: [0.00, 0.00, 0.32, 0.25], C: [0.35, 0.00, 0.20, 0.15], pupil: 0.34,
                 right: { A: [0.95, 0, 0.05, 0.00], B: [0.30, 0.90, 0.00, 0.00] } },
    tenderness:{ A: [0.70, 0, 0.50, 0.50], B: [0.28, 0.00, 0.00, 0.00], C: [0.00, 0.00, 0.00, 0.45], pupil: 0.47 },
    sleepy:    { A: [0.42, 0, 0.10, 0.00], B: [0.00, 0.00, 0.10, 0.00], C: [0.00, 0.00, 0.00, 0.35], pupil: 0.38, gy: -0.10 }
  };
  var SKINS = {
    night:  { skin: [0.15, 0.20, 0.40], sss: [0.36, 0.52, 0.95], sheen: [0.55, 0.66, 1.00], brow: [0.020, 0.024, 0.070], inner: [0.52, 0.38, 0.58] },
    violet: { skin: [0.25, 0.20, 0.44], sss: [0.62, 0.46, 0.95], sheen: [0.78, 0.66, 1.00], brow: [0.045, 0.025, 0.080], inner: [0.62, 0.38, 0.58] },
    indigo: { skin: [0.18, 0.18, 0.38], sss: [0.46, 0.42, 0.92], sheen: [0.64, 0.62, 1.00], brow: [0.025, 0.022, 0.065], inner: [0.56, 0.36, 0.58] },
    cobalt: { skin: [0.11, 0.24, 0.46], sss: [0.28, 0.62, 0.96], sheen: [0.50, 0.80, 1.00], brow: [0.015, 0.035, 0.080], inner: [0.48, 0.42, 0.64] },
    moon:   { skin: [0.40, 0.45, 0.60], sss: [0.70, 0.78, 0.98], sheen: [0.85, 0.90, 1.00], brow: [0.10, 0.11, 0.19], inner: [0.70, 0.50, 0.64] }
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
    ['uRes', 'uMid', 'uScale', 'uSep', 'uGaze', 'uA0', 'uA1', 'uB0', 'uB1', 'uC', 'uPupil', 'uSkin', 'uSSS', 'uSheen', 'uBrowCol', 'uLidInner', 'uDay', 'uOptics', 'uHasIris', 'uPresence', 'uIris']
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
      lastPointer: -1e9, nextGlance: 0, skin: SKINS.night, day: 0, optics: 0, presence: 1, frozen: false, emotion: 'calm', blinkSlow: false };

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
    function layout() {
      var w = canvas.width, h = canvas.height;
      var phone = canvas.clientWidth < 600;
      var scale = Math.min(h / 3.45, w / (phone ? 6.6 : 7.6));
      return { w: w, h: h, scale: scale, midX: w / 2, midY: h * 0.72 };
    }
    function aim(x, y) {
      var r = canvas.getBoundingClientRect();
      var dx = (x - (r.left + r.width / 2)) / (r.height * 1.4), dy = -(y - (r.top + r.height * 0.72)) / (r.height * 1.4);
      var m = Math.hypot(dx, dy), lim = 0.9;
      st.tx = m > lim ? dx / m * lim : dx; st.ty = (m > lim ? dy / m * lim : dy) * 0.85;
      st.lastPointer = performance.now();
    }
    window.addEventListener('pointermove', function (e) { aim(e.clientX, e.clientY); kick(); }, { passive: true });
    window.addEventListener('pointerdown', function (e) { aim(e.clientX, e.clientY); kick(); }, { passive: true });

    function approach(a, b, k) { for (var i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * k; }
    function blinkCurve(ms, slow) {
      var c = slow ? 190 : 85, hold = slow ? 90 : 35, o = slow ? 420 : 190;
      if (ms < c) { var x = ms / c; return x * x; }
      if (ms < c + hold) return 1;
      if (ms < c + hold + o) { var y = (ms - c - hold) / o; return Math.pow(1 - y, 3); }
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
      var f = layout();
      var conv = 0.035;
      gl.uniform2f(U.uRes, f.w, f.h);
      gl.uniform2f(U.uMid, f.midX, f.midY);
      gl.uniform1f(U.uScale, f.scale);
      gl.uniform1f(U.uSep, 2.0);
      gl.uniform4f(U.uGaze, st.gx + conv, st.gy, st.gx - conv, st.gy);
      var a0 = cur.A0.slice(), a1 = cur.A1.slice(); a0[1] = st.blink; a1[1] = st.blink;
      gl.uniform4fv(U.uA0, a0); gl.uniform4fv(U.uA1, a1);
      gl.uniform4fv(U.uB0, cur.B0); gl.uniform4fv(U.uB1, cur.B1);
      gl.uniform4fv(U.uC, cur.C);
      gl.uniform2f(U.uPupil, cur.pupil, cur.pupil);
      gl.uniform3fv(U.uSkin, st.skin.skin); gl.uniform3fv(U.uSSS, st.skin.sss); gl.uniform3fv(U.uSheen, st.skin.sheen);
      gl.uniform3fv(U.uBrowCol, st.skin.brow); gl.uniform3fv(U.uLidInner, st.skin.inner);
      gl.uniform1f(U.uDay, st.day); gl.uniform1f(U.uOptics, st.optics); gl.uniform1f(U.uPresence, st.presence);
      gl.uniform1f(U.uHasIris, hasIris); gl.uniform1i(U.uIris, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    var raf = 0, last = performance.now(), visible = true;
    function loop(now) {
      raf = 0;
      var dt = Math.min(64, now - last); last = now;
      step(now, dt); draw();
      if (visible && !document.hidden) raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } }
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) kick(); }).observe(canvas);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
    kick();

    return {
      setEmotion: setEmotion,
      setSkin: function (name) { if (SKINS[name]) { st.skin = SKINS[name]; kick(); } },
      setDay: function (v) { st.day = v ? 1 : 0; kick(); },
      setOptics: function (v) { st.optics = v ? 1 : 0; kick(); },
      setPresence: function (v) { st.presence = v; kick(); },
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
