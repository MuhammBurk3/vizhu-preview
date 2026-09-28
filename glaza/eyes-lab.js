// Вижу · лаборатория глаз, версия 4 (редактор).
// Один фрагментный шейдер WebGL2: глазное яблоко с преломлением в роговице,
// лицо с человеческими пропорциями, брови из отдельных волосков поверх мягкого тона,
// ресницы пучками. Складки кожи устроены как у сжатой кожи: скруглённые валики,
// острое дно складки, анатомический шаг линий. Свет считается по двум нормалям:
// мягкой (рассеяние под кожей) и резкой (линия складки и блики на валиках).
// Все параметры внешности настраиваются через setConfig().
(function () {
  'use strict';

  var FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform vec2 uMid; uniform float uScale; uniform float uSep;
uniform vec4 uGaze;
uniform vec4 uA0, uA1;   // open, blink, lowerRaise (cheek + lower lid), crow's feet
uniform vec4 uB0, uB1;   // inner brow raise, outer brow raise, brow lower, corrugator pinch
uniform vec4 uC;         // glabella lines, nasal root lines, forehead lines, under-eye
uniform vec2 uPupil;
uniform vec3 uSkin, uSSS, uSheen, uBrowCol, uLidInner, uIrisTint;
uniform float uDay, uOptics, uGlow, uHasIris, uPresence;
uniform vec4 uBrow;      // height offset, arch, tilt, length
uniform vec3 uBrowLook;  // thickness, density, strength
uniform float uOpenMul, uTilt, uIrisScale, uPupilMul, uIrisTintAmt, uSclera, uCatch;
uniform vec3 uLash;      // length, density, curl
uniform vec3 uSkinLook;  // wrinkle depth, fine detail, gloss
uniform vec3 uLidCol; uniform float uLidAmt;
uniform vec3 uLight;     // angle (radians), key intensity, gold rim
uniform sampler2D uIris;
out vec4 outColor;
#define uWrinkle uSkinLook.x
#define uDetail uSkinLook.y
#define uGloss uSkinLook.z
const float PI = 3.14159265;

float hash21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz)*p3.zy); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3. - 2.*f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a*noise(p); p = p*2.03 + 7.1; a *= .5; } return s; }
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float pores(vec2 p){ vec2 i = floor(p), f = fract(p); float md = 1.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(x, y); vec2 r = g + hash22(i + g) - f; md = min(md, dot(r, r)); }
  return sqrt(md); }
vec3 keyDir(){ float a = uLight.x; vec2 xy = vec2(-0.50, 0.62); xy = vec2(xy.x*cos(a) - xy.y*sin(a), xy.x*sin(a) + xy.y*cos(a)); return normalize(vec3(xy, 0.55)); }

// Compressed skin buckles into rounded ridges with sharp creases between them.
// u is measured in line spacings: creases at whole numbers, ridge tops halfway (value 0 there).
float ridges(float u){
  float v = abs(fract(u + 0.5) - 0.5)*2.;
  return pow(1. - (1. - v)*(1. - v), 0.55) - 1.;
}
// A single crease: a sharp line at d = 0, walls rising to rounded shoulders at |d| ~ w,
// and a roll of bunched skin beside it (the d < 0 side rolls less when asym < 1).
float crease(float d, float w, float asym){
  float x = min(abs(d)/w, 1.);
  float wall = pow(1. - (1. - x)*(1. - x), 0.55) - 1.;
  float side = mix(asym, 1., smoothstep(-0.3*w, 0.3*w, d));
  return wall + 0.38*side*exp(-pow((abs(d) - 1.05*w)/(0.62*w), 2.));
}

// A skin fold: a sharp dark crease with soft walls and rounded rolls of bunched skin beside it.
// w is the distance from the crease to the top of the roll; asym < 1 lowers the roll on the d < 0 side.
float fold(float d, float w, float asym){
  float ad = abs(d);
  float side = mix(asym, 1., smoothstep(-0.25*w, 0.25*w, d));
  return -0.50*exp(-ad/(0.20*w)) - 0.35*exp(-ad*ad/(0.30*w*w)) + 0.60*side*exp(-pow((ad - w)/(0.60*w), 2.));
}
float notch(float d, float w){ return fold(d, w, 1.); }
// A crease along a gently bent path: origin o, direction a, bend c, length len, width w.
// Tapers in at the start, fades out at the end, depth wanders a little along the way.
float creaseLine(vec2 P, vec2 o, float a, float c, float len, float w, float seed){
  vec2 d = P - o;
  float cs = cos(a), sn = sin(a);
  float s = d.x*cs + d.y*sn;
  if (s < -0.03 || s > len) return 0.;
  float n = -d.x*sn + d.y*cs - c*s*s - 0.008*sin(s*15. + seed*3.);
  float ww = w*(1. + 0.4*s/len);
  if (abs(n) > 3.2*ww) return 0.;
  float env = smoothstep(-0.03, 0.12, s)*smoothstep(len, len*0.40, s);
  return fold(n, ww, 0.7)*env*(0.70 + 0.30*noise(vec2(s*6., seed*5.)));
}

// ---------------- eyelids ----------------
void lidCurves(float xl, vec4 A, float gy, out float up, out float lo, out float k, out float t){
  t = clamp(xl, -1., 1.);
  k = max(1. - t*t, 0.);
  float tilt = 0.0475 + uTilt;
  float base = mix(-0.1225 - tilt, -0.1225 + tilt, (t + 1.)*.5);
  float open = A.x*uOpenMul;
  up = base + (0.445*open)*pow(k, 0.80)*(1. - 0.10*t) + gy*0.13*k;
  lo = base - (0.275 - 0.09*A.z)*mix(1., uOpenMul, 0.5)*pow(k, 1.10)*(1. + 0.16*t) + gy*0.05*k + A.z*0.03*k;
  float meet = lo + 0.03*k;
  up = mix(up, meet, A.y);
  lo = mix(lo, meet - 0.004, A.y*0.12);
}

// ---------------- brows ----------------
float browXH(vec4 B){ return -1.05 - 0.10*B.w; }
float browXT(vec4 B){ return 1.30 - 0.03*B.w + uBrow.w; }
float browS(float xl, vec4 B){ float xh = browXH(B); return (xl - xh)/(browXT(B) - xh); }
float browC(float s, vec4 B){
  float sc = clamp(s, 0., 1.);
  float y = 1.30 + uBrow.x + 0.19*uBrow.y*sin(PI*pow(sc, 0.85)) - 0.13*pow(max(sc - 0.62, 0.)/0.38, 1.6);
  y += 0.16*uBrow.z*(0.45 - sc);
  y += 0.30*B.x*pow(1. - sc, 1.6);
  y += 0.26*B.y*pow(sc, 1.2);
  y -= 0.24*B.z*(1. - 0.45*sc);
  y -= 0.10*B.w*pow(1. - sc, 2.);
  return y;
}
float browTh(float s){ float sc = clamp(s, 0., 1.); return uBrowLook.x*mix(0.40, 0.085, smoothstep(0.10, 1.0, sc))*mix(0.78, 1.0, smoothstep(-0.05, 0.12, s)); }
float browTangent(float s, vec4 B){ float e = 0.02;
  return atan((browC(s + e, B) - browC(s - e, B))/(2.*e*(browXT(B) - browXH(B)))); }
float browAngle(float s, float dn, vec4 B){
  float sc = clamp(s, 0., 1.);
  float head = 1.28 - 0.14*dn + 0.35*B.x - 0.30*B.w;
  float body = browTangent(sc, B) + 0.20 + mix(0.30, -0.28, dn*0.5 + 0.5);
  return mix(head, body, smoothstep(0.04, 0.32, sc));
}

// ---------------- skin form ----------------
// Crow's feet: separate creases fanning out from beyond the outer corner, the lower ones
// sweeping down along the cheek; finer lines further out; the skin there bunches as a whole.
float crowsFeet(vec2 P, float amt, float D, float seed){
  vec2 c0 = P - vec2(1.22, -0.08);
  if (dot(c0, c0) > 0.75) return 0.;
  float j = seed*1.7;
  float h = 0.;
  h += 0.80*creaseLine(P, vec2(1.19, 0.05 + 0.02*sin(j)), 0.30 + 0.05*sin(j), 0.10, 0.40, 0.050, j + 1.);
  h += 1.00*creaseLine(P, vec2(1.14, -0.05), 0.02 + 0.04*sin(j*2.), -0.18, 0.58, 0.058, j + 2.);
  h += 0.90*creaseLine(P, vec2(1.21, -0.17 + 0.02*sin(j*2.)), -0.30 + 0.05*sin(j*3.), -0.34, 0.50, 0.055, j + 3.);
  h += 0.65*creaseLine(P, vec2(1.07, -0.27), -0.66, -0.36, 0.42, 0.050, j + 4.);
  h += 0.45*D*creaseLine(P, vec2(1.40, -0.10), 0.12, -0.05, 0.26, 0.034, j + 5.);
  h += 0.40*D*creaseLine(P, vec2(1.36, 0.14), 0.45, 0.10, 0.22, 0.032, j + 6.);
  h += 0.35*D*creaseLine(P, vec2(1.33, -0.30), -0.45, -0.30, 0.26, 0.034, j + 7.);
  vec2 cb = c0*vec2(1.0, 1.3);
  return amt*(0.015*h + 0.020*exp(-dot(cb, cb)/0.09));
}
// Under the eye: fine lines of a smile following the lower lid, strongest toward the outer corner.
float underLines(float xl, float belowL, float amt, float D, float seed){
  if (belowL < 0.03 || belowL > 0.42 || xl < -0.7 || xl > 1.35) return 0.;
  float h = 0.;
  float wob = 0.6 + 0.4*noise(vec2(xl*3.1, seed*2.));
  h += wob*notch(belowL - 0.132 - 0.012*sin(xl*4.3 + seed) + 0.02*xl, 0.040)*smoothstep(-0.10, 0.45, xl)*smoothstep(1.20, 0.88, xl);
  h += 0.70*(1.4 - wob)*notch(belowL - 0.235 + 0.06*xl - 0.012*sin(xl*3.1 + seed*2.), 0.042)*smoothstep(0.30, 0.70, xl)*smoothstep(1.30, 1.00, xl);
  h += 0.40*D*notch(belowL - 0.090 - 0.006*sin(xl*7. + seed), 0.026)*smoothstep(0.40, 0.70, xl)*smoothstep(1.05, 0.85, xl);
  return amt*0.010*h;
}
float eyeForm(vec2 p, float side, vec4 A, vec4 B, float gy, float ue, float seed){
  float xl = p.x*side;
  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);
  float aboveU = p.y - up, belowL = lo - p.y;
  float W = uWrinkle, D = uDetail;
  // the globe under the lids and the orbit around it
  float h = 0.12*exp(-dot(p*vec2(0.85, 1.0), p*vec2(0.85, 1.0))/0.9);
  // upper lid: a smooth tarsal band, then the crease with the orbital fold rolling over it
  float spanU = smoothstep(1.12, 0.50, abs(xl - 0.05));
  float open = clamp(A.x*uOpenMul, 0., 1.4);
  float cr = 0.21 + 0.07*(1. - min(open, 1.)) - 0.02*t;
  h += 0.014*smoothstep(0.0, 0.05, aboveU)*smoothstep(cr + 0.01, 0.02, aboveU)*spanU;
  h += 0.017*crease(aboveU - cr, 0.09, 0.25)*spanU*smoothstep(-0.02, 0.06, aboveU);
  float bs = browS(xl, B); float yb = browC(bs, B);
  // the sulcus under the brow bone, then the brow ridge
  h -= 0.030*exp(-pow((p.y - mix(up + cr + 0.12, yb - 0.22, 0.5))/0.28, 2.))*smoothstep(1.3, 0.4, abs(xl - 0.05));
  h += 0.07*exp(-pow((p.y - (yb - 0.02))/0.34, 2.))*smoothstep(1.9, 0.6, abs(xl - 0.1));
  // lower lid: the pretarsal roll (grows in a smile), the lid-cheek groove, the cheek
  h += (0.012 + 0.045*A.z)*exp(-pow((belowL - 0.062 - 0.012*A.z)/0.048, 2.))*smoothstep(1.05, 0.55, abs(xl));
  float yj = 0.20 - 0.04*A.z;
  h += (0.008 + 0.016*ue)*W*crease(belowL - yj, 0.065, 0.6)*smoothstep(1.1, 0.2, abs(xl + 0.05));
  h += (0.06 + 0.11*A.z)*exp(-pow((belowL - 0.47 + 0.07*A.z)/0.26, 2.))*smoothstep(1.7, 0.3, abs(xl - 0.15));
  float crow = A.w*W;
  if (crow > 0.004) h += crowsFeet(vec2(xl, p.y), crow, D, seed);
  float smile = A.z*W;
  if (smile > 0.004) h += underLines(xl, belowL, smile, D, seed);
  return h;
}
float innerBrowY(){ return 0.5*(browC(0., uB0) + browC(0., uB1)); }
float globalForm(vec2 q){
  float yI = innerBrowY();
  float W = uWrinkle, D = uDetail;
  float ax = abs(q.x);
  // the nasal bridge and the forehead
  float h = 0.10*exp(-pow(q.x/0.45, 2.))*smoothstep(1.0, 0.1, q.y);
  h += 0.05*smoothstep(yI, yI + 0.6, q.y);
  // frown: two vertical creases (the "11"), deepest low down, with bunched skin between
  // and above the brow heads
  float g = uC.x*W;
  if (g > 0.004) {
    float x0 = 0.25 - 0.05*uC.x;
    float yy = q.y - yI;
    for (int si = 0; si < 2; si++) {
      float sg = si == 0 ? -1. : 1.;
      float xw = q.x - sg*(x0 + 0.09*yy + 0.05*yy*yy) - 0.010*sin(q.y*11. + sg*2.);
      float env = smoothstep(-0.52, -0.30, yy)*smoothstep(0.30, 0.02, yy);
      float dep = mix(1.0, 0.55, smoothstep(-0.30, 0.25, yy))*(0.85 + 0.15*noise(vec2(q.y*5., sg*4.)));
      h += g*0.020*fold(xw, 0.075, 0.8)*env*dep;
      float xw2 = q.x - sg*(x0 + 0.14 + 0.14*yy);
      float env2 = smoothstep(-0.26, -0.12, yy)*smoothstep(0.18, 0.0, yy);
      h += g*D*0.009*notch(xw2, 0.050)*env2;
    }
    h += g*0.030*exp(-pow(q.x/0.14, 2.) - pow((yy + 0.12)/0.28, 2.));
    h += g*0.020*exp(-pow((ax - x0 - 0.26)/0.20, 2.) - pow((yy - 0.02)/0.20, 2.));
  }
  // procerus: short curved lines across the root of the nose
  float n = uC.y*W;
  if (n > 0.004) {
    float yn = yI - 0.64;
    h += n*0.012*fold(q.y - yn - 0.55*q.x*q.x - 0.012*sin(q.x*8. + 1.), 0.060, 0.7)*smoothstep(0.34, 0.08, ax)*(0.75 + 0.25*noise(vec2(q.x*5., 3.)));
    h += n*D*0.007*notch(q.y - yn + 0.13 - 0.9*q.x*q.x + 0.015*sin(q.x*9.), 0.040)*smoothstep(0.20, 0.03, abs(q.x + 0.05));
    h += n*0.012*exp(-pow(q.x/0.30, 2.) - pow((q.y - yn - 0.06)/0.10, 2.));
  }
  // raised brows: wavy lines across the forehead following the brows, broken here and there
  float f = uC.z*W;
  if (f > 0.004) {
    float yb = yI + 0.40;
    float arch = 0.10*exp(-pow((ax - uSep*0.70)/0.95, 2.)) - 0.06*exp(-pow(ax/0.55, 2.));
    float spanF = exp(-pow((ax - uSep*0.78)/1.10, 2.)) + 0.5*uB0.x*exp(-pow(ax/0.60, 2.));
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float yl = yb + fi*0.32 + arch*(1. + 0.3*fi) + 0.022*sin(q.x*2.1 + fi*1.9) + 0.03*(noise(vec2(q.x*1.2, fi*3.)) - 0.5);
      float brk = smoothstep(0.16, 0.48, noise(vec2(q.x*1.5 + fi*4.1, fi*1.7 + 2.)));
      h += f*0.018*fold(q.y - yl, 0.075 + 0.010*fi, 0.75)*(1. - 0.15*fi)*brk*spanF;
      h += f*D*0.006*notch(q.y - yl - 0.16 - 0.02*sin(q.x*3.3 + fi), 0.040)*spanF*smoothstep(0.35, 0.70, noise(vec2(q.x*2.2, fi + 7.)));
    }
    h += f*0.012*spanF*smoothstep(yb - 0.15, yb + 0.1, q.y);
  }
  return h;
}
float totalH(vec2 q){
  float h = globalForm(q);
  h += eyeForm(q - vec2(-uSep, 0.), -1., uA0, uB0, uGaze.y, uC.w, 1.3);
  h += eyeForm(q - vec2( uSep, 0.),  1., uA1, uB1, uGaze.w, uC.w, 5.0);
  return h;
}
float presence(vec2 q){
  float keep = 1.;
  for (int e = 0; e < 2; e++) {
    float cx = e == 0 ? -uSep : uSep;
    vec2 d = (q - vec2(cx*0.96, 0.72))/vec2(2.05, 1.95);
    keep *= 1. - exp(-pow(length(d), 2.2)*1.45);
  }
  keep *= 1. - 0.9*exp(-pow(q.x/1.3, 2.) - pow((q.y - 0.95)/1.45, 2.));
  return 1. - keep;
}
// Where expressions fold the skin, it shows up even when the face is faded out.
float expressionReveal(vec2 q){
  float keep = 1.;
  for (int e = 0; e < 2; e++) {
    float sd = e == 0 ? -1. : 1.;
    vec4 A = e == 0 ? uA0 : uA1; vec4 B = e == 0 ? uB0 : uB1;
    vec2 p = q - vec2(sd*uSep, 0.); float xl = p.x*sd;
    float up, lo, k, t; lidCurves(xl, A, 0., up, lo, k, t);
    float near = exp(-max(max(p.y - up, lo - p.y), 0.)/0.14)*smoothstep(1.35, 0.95, abs(xl));
    float bs = browS(xl, B);
    float brow = 0.75*exp(-pow((p.y - browC(bs, B))/0.32, 2.))*smoothstep(-0.25, 0.05, bs)*smoothstep(1.2, 0.95, bs);
    vec2 d = vec2(xl, p.y) - vec2(1.10, -0.10);
    float crow = A.w*smoothstep(0.85, 0.15, length(d*vec2(0.9, 1.1)))*smoothstep(-0.45, 0.05, d.x);
    float under = max(uC.w, A.z)*exp(-pow((lo - p.y - 0.25)/0.2, 2.))*smoothstep(1.3, 0.35, abs(xl - 0.1));
    keep *= (1. - near)*(1. - brow)*(1. - crow)*(1. - under);
  }
  float yI = innerBrowY();
  keep *= 1. - uC.x*exp(-pow(q.x/0.50, 2.) - pow((q.y - yI + 0.1)/0.48, 2.));
  keep *= 1. - uC.y*exp(-pow(q.x/0.4, 2.) - pow((q.y - yI + 0.64)/0.2, 2.));
  keep *= 1. - uC.z*0.9*exp(-pow((abs(q.x) - uSep*0.7)/1.3, 2.) - pow((q.y - yI - 0.62)/0.45, 2.));
  return 1. - keep;
}

// ---------------- lighting ----------------
vec3 env(vec3 d, float day){
  vec3 sky = mix(vec3(0.004, 0.006, 0.02), vec3(0.18, 0.16, 0.14), day);
  vec2 w = vec2(d.x + 0.42, d.y - 0.46);
  float rr = length(max(abs(w) - vec2(0.085, 0.060), 0.)) - 0.05;
  vec3 c = sky + vec3(1.0, 0.97, 0.92)*smoothstep(0.035, -0.025, rr)*20.*uCatch;
  vec2 gd = d.xy - vec2(0.56, -0.34);
  return c + lin(vec3(0.91, 0.74, 0.33))*exp(-60.*dot(gd, gd))*3.0*(0.4 + 0.6*uLight.z)*min(uCatch, 1.5);
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
    o *= 1. - 0.55*span*smoothstep(-0.01, 0.01, aboveU)*smoothstep(0.12*uLash.x, 0.0, aboveU);
    float bs = browS(xl, B); float dn = (p.y - browC(bs, B))/(browTh(bs)*0.5);
    o *= 1. - 0.22*min(uBrowLook.z, 1.5)*smoothstep(1.4, 0.3, abs(dn))*smoothstep(-0.1, 0.1, bs)*smoothstep(1.1, 0.9, bs);
  }
  return o;
}
float micro(vec2 q){ return (1. - pores(q*40.))*0.00020 + noise(q*90.)*0.00006; }
vec3 shadeSkin(vec2 q, float pres){
  // Light scatters under the skin, so diffuse shading follows a normal blurred over ~0.7 mm;
  // only glints and the dark bottom of a crease stay sharp.
  float e = 1.0/uScale, E = max(0.016, 1.3/uScale);
  float h0 = totalH(q);
  float hxp = totalH(q + vec2(e, 0.)), hxm = totalH(q - vec2(e, 0.));
  float hyp = totalH(q + vec2(0., e)), hym = totalH(q - vec2(0., e));
  float Hxp = totalH(q + vec2(E, 0.)), Hxm = totalH(q - vec2(E, 0.));
  float Hyp = totalH(q + vec2(0., E)), Hym = totalH(q - vec2(0., E));
  vec2 gs = vec2(hxp - hxm, hyp - hym)/(2.*e);
  gs *= min(1., 1.1/max(length(gs), 1e-4));
  float m0 = micro(q);
  vec2 gm = vec2(micro(q + vec2(e, 0.)) - m0, micro(q + vec2(0., e)) - m0)/e*(0.4 + 0.6*uDetail);
  vec3 Ns = normalize(vec3(-gs - gm, 1.));
  vec3 Nb = normalize(vec3(-(Hxp - Hxm)/(2.*E), -(Hyp - Hym)/(2.*E), 1.));
  float lapS = (hxp + hxm + hyp + hym - 4.*h0)/(e*e)/uScale;
  float lapB = (Hxp + Hxm + Hyp + Hym - 4.*h0)/(E*E);
  // only the concave bottom darkens; convex shoulders are not rimmed with light
  float cav = clamp(lapS*0.22, 0.0, 0.35) + clamp(lapB*0.006, -0.05, 0.40);
  vec3 V = vec3(0., 0., 1.);
  vec3 albedo = lin(mix(uSkin, vec3(0.93, 0.95, 1.0), uDay*0.70));
  albedo *= 1. + 0.06*(fbm(q*2.3 + 3.) - 0.5) + 0.04*(noise(q*8.5) - 0.5);
  float periKeep = 1.;
  for (int e2 = 0; e2 < 2; e2++) {
    float sd = e2 == 0 ? -1. : 1.;
    vec4 A = e2 == 0 ? uA0 : uA1;
    vec2 pp = q - vec2(sd*uSep, 0.); float xl = pp.x*sd;
    float up, lo, k, t; lidCurves(xl, A, 0., up, lo, k, t);
    float dOut = max(max(pp.y - up, lo - pp.y), 0.) + max(abs(xl) - 1., 0.)*0.8;
    periKeep *= 1. - exp(-dOut/0.22)*smoothstep(1.4, 0.9, abs(xl));
  }
  float peri = 1. - periKeep;
  albedo *= mix(vec3(1.0), vec3(0.80, 0.78, 0.96), peri*(1. - uDay*0.4));
  // eyelid material (the violet lids of ВИЖУ): the upper lid up to its crease and the lower lid rim
  float lidMask = 0., lidGrad = 0.;
  for (int e3 = 0; e3 < 2; e3++) {
    float sd = e3 == 0 ? -1. : 1.;
    vec4 A = e3 == 0 ? uA0 : uA1;
    vec2 pp = q - vec2(sd*uSep, 0.); float xl = pp.x*sd;
    float up, lo, k, t; lidCurves(xl, A, e3 == 0 ? uGaze.y : uGaze.w, up, lo, k, t);
    float aU = pp.y - up, bL = lo - pp.y;
    float crl = 0.21 + 0.07*(1. - min(clamp(A.x*uOpenMul, 0., 1.4), 1.)) - 0.02*t;
    float upL = smoothstep(-0.01, 0.025, aU)*smoothstep(crl + 0.09, crl - 0.05, aU);
    float loL = 0.80*smoothstep(-0.005, 0.015, bL)*smoothstep(0.14, 0.03, bL);
    float m = max(upL, loL)*smoothstep(1.14, 0.55, abs(xl - 0.03));
    if (m > lidMask) { lidMask = m; lidGrad = upL >= loL ? smoothstep(0.0, crl, aU) : 0.4*smoothstep(0.12, 0.0, bL); }
  }
  lidMask *= uLidAmt;
  // deeper by the lashes, lighter toward the crease, like the lid of the site's eyes
  albedo = mix(albedo, lin(uLidCol)*mix(0.62, 1.08, lidGrad), lidMask);
  vec3 sss = lin(mix(uSSS, vec3(1.0), uDay*0.55));
  vec3 L1 = keyDir();
  vec3 L2 = normalize(vec3(0.60, -0.40, 0.70));
  vec3 L3 = normalize(vec3(0.97, 0.10, 0.22));
  vec3 Nd = normalize(mix(Nb, Ns, 0.30));
  float d1 = dot(Nd, L1), dB = dot(Nb, L1);
  float wrap = clamp((d1 + 0.20)/1.20, 0., 1.);
  vec3 col = albedo*wrap*vec3(1.0, 0.97, 0.94)*uLight.y;
  col += sss*albedo*pow(clamp(1. - abs(dB - 0.1), 0., 1.), 3.)*0.55*uLight.y;
  // light that went into the skin comes out on the shaded side of a fold, tinted
  col += sss*albedo*(1. - wrap)*0.22*uLight.y*smoothstep(0.02, 0.3, 1. - Nd.z);
  col += albedo*clamp(dot(Nb, L2)*0.5 + 0.5, 0., 1.)*lin(vec3(0.40, 0.52, 0.95))*0.20;
  col += lin(vec3(0.91, 0.74, 0.33))*pow(clamp(dot(Nb, L3), 0., 1.), 4.)*0.10*uLight.z*(1. - uDay*0.6);
  vec3 H = normalize(L1 + V);
  vec3 Nsp = normalize(mix(Nb, Ns, 0.55));
  float nh = clamp(dot(Nsp, H), 0., 1.), nhb = clamp(dot(Nb, H), 0., 1.);
  col += vec3(1.0, 0.98, 0.95)*(pow(nh, 60.)*0.10 + pow(nh, 22.)*0.05 + pow(nhb, 14.)*0.05)*uLight.y*uGloss;
  col += lin(uSheen)*albedo*pow(1. - clamp(Nb.z, 0., 1.), 3.)*0.8;
  col += vec3(1.0, 0.97, 1.0)*pow(nhb, 10.)*0.07*lidMask*uLight.y;
  // shadow inside creases keeps the colour of light scattered in the skin
  vec3 deep = sss/max(max(sss.r, max(sss.g, sss.b)), 1e-3);
  col *= mix(vec3(1.), deep*0.30, clamp(cav, 0., 1.));
  col *= 1. - 0.6*min(cav, 0.);
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
  vec3 L = keyDir();
  vec3 sc = mix(lin(vec3(0.76, 0.73, 0.70)), lin(vec3(0.95, 0.93, 0.89)), day)*uSclera;
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
      vec2 q2 = vec2(dot(qq, u), dot(qq, w))/(Ri*uIrisScale);
      float r = length(q2); float a = atan(q2.y, q2.x);
      float pr = clamp(pupil*uPupilMul, 0.12, 0.80)*(1. + 0.012*sin(a*5. + seed));
      float s = clamp((r - pr)/(1. - pr), 0., 1.);
      vec3 ir;
      if (uHasIris > 0.5) {
        vec2 dir = r > 1e-4 ? q2/r : vec2(0.);
        ir = lin(texture(uIris, 0.5 + vec2(dir.x, -dir.y)*mix(0.37, 1.0, s)*0.47*(side > 0. ? -1. : 1.)).rgb)*1.35;
      } else {
        ir = mix(lin(vec3(0.93, 0.70, 0.30)), lin(vec3(0.62, 0.34, 0.10)), smoothstep(0.1, 0.7, s))*(0.5 + fbm(vec2(a*10., s*3.)));
      }
      vec3 tint = lin(uIrisTint);
      vec3 recol = tint*(luma(ir)/max(luma(tint), 0.02))*0.95;
      ir = mix(ir, recol, uIrisTintAmt);
      ir *= 0.60 + 0.80*smoothstep(1.0, 0.1, length(q2 - vec2(0.38, -0.42)));
      ir *= mix(1., 0.30, smoothstep(0.84, 1.0, s));
      vec3 glowCol = mix(lin(vec3(0.95, 0.78, 0.40)), tint*1.2, uIrisTintAmt*0.6);
      if (uOptics > 0.5) {
        float blades = smoothstep(0.035, 0.0, abs(fract(a*12./(2.*PI) + s*0.9) - 0.5) - 0.44)*smoothstep(0.05, 0.25, s)*smoothstep(0.75, 0.5, s);
        ir *= 1. - 0.22*blades;
        ir += glowCol*smoothstep(0.03, 0.0, abs(s - 0.06))*(0.25 + 0.9*uGlow);
        ir += glowCol*smoothstep(0.02, 0.0, abs(s - 0.80))*(0.08 + 0.3*uGlow);
      }
      ir = mix(vec3(0.0015), ir, smoothstep(pr - 0.012, pr + 0.012, r));
      if (uOptics > 0.5) ir += glowCol*uGlow*0.35*smoothstep(pr, pr*0.2, r)*smoothstep(pr*0.0, pr*0.9, r);
      ir *= 0.55 + 0.6*clamp(dot(nc, L)*0.5 + 0.5, 0., 1.);
      vec3 under = mix(ir, scl*0.55, smoothstep(0.985, 1.03, r));
      float F = 0.025 + 0.975*pow(1. - max(dot(-rd, nc), 0.), 5.);
      vec3 rc = reflect(rd, nc);
      ccol = under*(1. - F) + F*env(rc, day) + pow(max(dot(rc, L), 0.), 1400.)*60.*uCatch*vec3(1., .97, .9);
    }
  }
  vec3 ball = mix(surf, ccol, cm);
  float ao = mix(0.10, 1.0, pow(smoothstep(0.0, 0.32, dU), 0.8))*mix(0.45, 1.0, smoothstep(0.0, 0.08, dL));
  ao *= mix(0.50, 1.0, smoothstep(1.0, 0.55, abs(xl)));
  ball *= ao;
  float men = smoothstep(0.03, 0.010, dL)*smoothstep(0.0, 0.006, dL)*k;
  ball += lin(vec3(0.95, 0.93, 0.90))*men*mix(0.10, 0.18, day)*(0.6 + 0.4*sin(xl*9. + seed))*min(uCatch, 1.5);
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

// ---------------- lashes ----------------
vec4 upperLashes(vec2 p, float side, vec4 A, float gy, float seed){
  float xl = p.x*side;
  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);
  if (p.y < up - 0.07 || p.y > up + 0.52*uLash.x || abs(xl) > 1.6) return vec4(0.);
  vec2 P = vec2(xl, p.y);
  float aa = 0.85/uScale;
  float cov = 0.;
  for (int layer = 0; layer < 3; layer++) {
    float fl = float(layer);
    float N = floor((layer == 0 ? 34. : (layer == 1 ? 30. : 42.))*uLash.y);
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
      float len = mix(0.13, 0.40, smoothstep(-0.9, 0.6, xr))*mix(0.60, 1.10, h2)*(0.55 + 0.45*kr)*lenK*uLash.x;
      float curl = (mix(0.25, 1.05, lat)*mix(0.55, 1.0, h) + 0.10)*uLash.z;
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
  float mass = smoothstep(0.085, 0.0, p.y - up)*step(up - 0.01, p.y)*edge*0.55*k*min(uLash.y, 1.2);
  float a = clamp(max(max(cov*edge, line), mass), 0., 1.);
  vec3 ink = lin(mix(uBrowCol, vec3(0.005, 0.006, 0.016), 0.65));
  return vec4(ink*a, a);
}
vec4 lowerLashes(vec2 p, float side, vec4 A, float gy, float seed){
  float xl = p.x*side;
  float up, lo, k, t; lidCurves(xl, A, gy, up, lo, k, t);
  if (p.y > lo + 0.02 || p.y < lo - 0.18 || xl < -0.7 || xl > 1.2) return vec4(0.);
  vec2 P = vec2(xl, p.y);
  float N = floor(26.*uLash.y);
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
    float len = mix(0.045, 0.10, lat)*mix(0.7, 1.1, h)*kr*uLash.x;
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

// ---------------- brows: a soft streaked mass of fine hairs, long single hairs on top ----------------
vec4 brow(vec2 p, float side, vec4 B){
  float xl = p.x*side;
  float s = browS(xl, B);
  if (s < -0.18 || s > 1.14) return vec4(0.);
  float yc = browC(s, B), thS = browTh(s);
  if (abs(p.y - yc) > thS*0.5 + 0.30) return vec4(0.);
  vec2 P = vec2(xl, p.y);
  float str = clamp(uBrowLook.z, 0., 2.);
  float dens = uBrowLook.y;
  vec3 base = lin(mix(uBrowCol, uSkin*0.55, uDay*0.25));
  vec3 L = keyDir();
  float dnS = (p.y - yc)/(thS*0.5);
  float mask = smoothstep(1.15, 0.25, abs(dnS + 0.06))*smoothstep(-0.12, 0.22, s)*smoothstep(1.05, 0.72, s);
  float tone = 0.;
  if (mask > 0.002) {
    float a0 = browAngle(s, clamp(dnS, -1., 1.), B);
    vec2 dir = vec2(cos(a0), sin(a0));
    float st = 0.;
    for (int k = -3; k <= 3; k++) st += noise((P + dir*float(k)*0.016)*70. + side*9.);
    st = smoothstep(0.30, 0.70, st/7.);
    tone = mask*(0.34 + 0.46*st)*min(dens, 1.6)*(0.45 + 0.55*min(str, 1.5));
  }
  float cs = 0.034;
  vec2 cell = floor(P/cs);
  float cov = 0.; vec3 acc = vec3(0.);
  float aa = 0.8/uScale;
  for (int dy = -6; dy <= 2; dy++) {
    for (int dx = -11; dx <= 2; dx++) {
      vec2 c = cell + vec2(float(dx), float(dy));
      vec2 hr = hash22(c + side*17.3);
      vec2 R = (c + hr)*cs;
      vec2 PR = P - R;
      if (dot(PR, PR) > 0.13) continue;
      float sr = browS(R.x, B);
      if (sr < -0.06 || sr > 1.03) continue;
      float ycr = browC(sr, B), thr = browTh(sr);
      float dn = (R.y - ycr)/(thr*0.5);
      if (abs(dn) > 1.05) continue;
      float df = smoothstep(1.05, 0.45, abs(dn))*smoothstep(-0.06, 0.22, sr)*smoothstep(1.03, 0.85, sr);
      if (hash21(c*1.37 + side) > (0.28 + 0.62*df)*dens) continue;
      float h4 = hash21(c + 3.3), h5 = hash21(c + 5.1);
      float ang = browAngle(sr, dn, B) + (hr.x - 0.5)*0.36;
      float len = mix(0.16, 0.34, hr.y)*mix(1.0, 0.62, clamp(sr, 0., 1.))*mix(0.55, 1.0, smoothstep(0.0, 0.25, sr))*mix(0.75, 1.0, df);
      float bend = (h5 - 0.5)*0.6 - 0.22;
      vec2 prev = R; float best = 1e3, bt = 0.; float segA = ang;
      for (int k = 1; k <= 3; k++) {
        float fk = float(k);
        float a = ang + bend*(fk/3.);
        vec2 nxt = prev + vec2(cos(a), sin(a))*len/3.;
        vec2 pa = P - prev, ba = nxt - prev;
        float hs = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.);
        float d = length(pa - ba*hs);
        if (d < best) { best = d; bt = (fk - 1. + hs)/3.; segA = a; }
        prev = nxt;
      }
      float w = mix(0.0052, 0.0010, bt)*mix(0.8, 1.2, h4);
      float wEff = max(w, aa*0.7);
      float cv = smoothstep(wEff + aa*0.5, wEff - aa*0.5, best)*min(1., w/wEff*1.3)*(1. - smoothstep(0.78, 1.0, bt));
      cv *= mix(0.50, 0.95, h4)*min(1., 0.30 + 0.70*str);
      float sheen = pow(1. - abs(dot(vec2(cos(segA), sin(segA)), normalize(L.xy))), 6.);
      vec3 hc = base*mix(0.65, 1.55, hash21(c + 9.7))*mix(0.9, 1.25, bt) + lin(uSheen)*0.06*sheen*mix(0.6, 1.0, uDay);
      hc *= mix(1.40, 0.60, clamp(str*0.5, 0., 1.));
      acc = acc*(1. - cv) + hc*cv;
      cov = cov + cv*(1. - cov);
    }
  }
  vec3 toneCol = base*mix(1.30, 0.70, clamp(str*0.5, 0., 1.));
  vec3 col = acc + toneCol*tone*(1. - cov);
  float a = cov + tone*(1. - cov);
  return vec4(col, a);
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
  float vis = clamp(1. - (1. - pres*uPresence)*(1. - expressionReveal(q)), 0., 1.);
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
    attention: { A: [1.00, 0, 0.00, 0.00], B: [0.28, 0.30, 0.00, 0.00], C: [0.00, 0.00, 0.30, 0.00], pupil: 0.42 },
    joy:       { A: [0.72, 0, 0.80, 1.00], B: [0.12, 0.00, 0.14, 0.00], C: [0.00, 0.00, 0.00, 0.80], pupil: 0.40 },
    surprise:  { A: [1.20, 0, 0.00, 0.00], B: [0.95, 0.90, 0.00, 0.00], C: [0.00, 0.00, 1.00, 0.00], pupil: 0.44 },
    empathy:   { A: [0.80, 0, 0.10, 0.00], B: [0.90, -0.30, 0.00, 0.40], C: [0.40, 0.00, 0.60, 0.25], pupil: 0.41, gy: -0.12 },
    thinking:  { A: [0.78, 0, 0.35, 0.18], B: [0.00, 0.10, 0.45, 0.65], C: [0.80, 0.10, 0.00, 0.20], pupil: 0.33, gx: -0.35, gy: 0.30 },
    strict:    { A: [1.02, 0, 0.45, 0.12], B: [0.00, 0.00, 0.95, 0.95], C: [1.00, 0.70, 0.00, 0.30], pupil: 0.30 },
    doubt:     { A: [0.84, 0, 0.32, 0.22], B: [0.00, 0.00, 0.32, 0.25], C: [0.35, 0.00, 0.20, 0.15], pupil: 0.34,
                 right: { A: [0.95, 0, 0.05, 0.00], B: [0.30, 0.90, 0.00, 0.00] } },
    tenderness:{ A: [0.70, 0, 0.50, 0.50], B: [0.28, 0.00, 0.00, 0.00], C: [0.00, 0.00, 0.00, 0.45], pupil: 0.47 },
    sleepy:    { A: [0.42, 0, 0.10, 0.00], B: [0.00, 0.00, 0.10, 0.00], C: [0.00, 0.00, 0.00, 0.35], pupil: 0.38, gy: -0.10 }
  };
  var SKIN_PRESETS = { night: '#26335f', violet: '#403370', indigo: '#2e2d61', cobalt: '#1c3e76', moon: '#6b7597' };

  var DEFAULTS = {
    emotion: 'calm', intensity: 1,
    skin: SKIN_PRESETS.night, presence: 1, bg: 'night',
    follow: true, blinking: true,
    zoom: 1, sep: 2.0, eyeOpen: 1, tilt: 0,
    browHeight: 0, browArch: 1, browTilt: 0, browLength: 0, browThick: 1.1, browDensity: 1, browStrength: 1, browMotion: 1, browColor: '#0b0d20',
    irisColor: '#c98a2e', irisTint: 0, irisSize: 1, pupil: 1, optics: false, glow: 0.5, sclera: 1, catchlight: 1,
    lashLen: 1, lashDensity: 1, lashCurl: 1, lidColor: '#4c2f9e', lidAmount: 0.8,
    wrinkles: 1, detail: 1, gloss: 1,
    lightAngle: 0, light: 1, rim: 1
  };

  function hexToRgb(hex) { var h = String(hex || '').replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16); if (!isFinite(n)) return [0, 0, 0]; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function rgbToHsl(c) { var r = c[0], g = c[1], b = c[2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l]; }
  function hslToRgb(h, s, l) { if (s === 0) return [l, l, l];
    function f(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)]; }
  function skinSet(hex, lidHex, lidAmt) {
    var lid = lidHex ? hexToRgb(lidHex) : null;
    var rgb = hexToRgb(hex), hsl = rgbToHsl(rgb);
    var sss = hslToRgb(hsl[0], Math.min(1, hsl[1] * 1.15 + 0.1), Math.min(0.78, Math.max(0.55, hsl[2] * 1.6 + 0.3)));
    var sheen = hslToRgb(hsl[0], hsl[1] * 0.55, 0.86);
    var inner = [0, 1, 2].map(function (i) { return rgb[i] * 0.35 + [0.62, 0.38, 0.58][i] * 0.65; });
    if (lid) inner = inner.map(function (v, i) { return v * (1 - 0.45 * lidAmt) + lid[i] * 0.45 * lidAmt; });
    return { skin: rgb, sss: sss, sheen: sheen, inner: inner };
  }

  function create(canvas, opts) {
    opts = opts || {};
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
    ['uRes', 'uMid', 'uScale', 'uSep', 'uGaze', 'uA0', 'uA1', 'uB0', 'uB1', 'uC', 'uPupil', 'uSkin', 'uSSS', 'uSheen', 'uBrowCol', 'uLidInner', 'uIrisTint',
     'uDay', 'uOptics', 'uGlow', 'uHasIris', 'uPresence', 'uBrow', 'uBrowLook', 'uOpenMul', 'uTilt', 'uIrisScale', 'uPupilMul', 'uIrisTintAmt',
     'uSclera', 'uCatch', 'uLash', 'uSkinLook', 'uLight', 'uIris', 'uLidCol', 'uLidAmt']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var hasIris = 0;
    var img = new Image();
    img.onload = function () {
      var tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      hasIris = 1; dirty = true; kick();
    };
    img.src = opts.iris || 'iris.jpg';

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cfg = Object.assign({}, DEFAULTS);
    var skin = skinSet(cfg.skin, cfg.lidColor, cfg.lidAmount);
    var calm = PRESETS.calm;
    var cur = { A0: calm.A.slice(), A1: calm.A.slice(), B0: calm.B.slice(), B1: calm.B.slice(), C: calm.C.slice(), pupil: calm.pupil };
    var tgt = JSON.parse(JSON.stringify(cur));
    var st = { gx: 0, gy: 0, tx: 0, ty: 0, egx: 0, egy: 0, blink: 0, blinkStart: -1, nextBlink: performance.now() + 1500, double: false,
      lastPointer: -1e9, nextGlance: 0, frozen: false, blinkSlow: false };

    function mixArr(a, b, k) { return a.map(function (v, i) { return v + (b[i] - v) * k; }); }
    function applyEmotion() {
      var p = PRESETS[cfg.emotion] || calm, k = cfg.intensity;
      tgt.A0 = mixArr(calm.A, p.A, k); tgt.A1 = mixArr(calm.A, p.right ? p.right.A : p.A, k);
      tgt.B0 = mixArr(calm.B, p.B, k); tgt.B1 = mixArr(calm.B, p.right ? p.right.B : p.B, k);
      tgt.C = mixArr(calm.C, p.C, k).map(function (v) { return Math.max(0, v); });
      tgt.A0 = tgt.A0.map(function (v, i) { return i === 0 ? v : Math.max(0, v); }); tgt.A1 = tgt.A1.map(function (v, i) { return i === 0 ? v : Math.max(0, v); });
      tgt.pupil = calm.pupil + (p.pupil - calm.pupil) * k;
      st.egx = (p.gx || 0) * k; st.egy = (p.gy || 0) * k;
      st.blinkSlow = cfg.emotion === 'sleepy';
      kick();
    }
    function setConfig(part) {
      part = part || {};
      var prevEmotion = cfg.emotion;
      Object.keys(part).forEach(function (key) { if (key in DEFAULTS) cfg[key] = part[key]; });
      skin = skinSet(cfg.skin, cfg.lidColor, cfg.lidAmount);
      if ('emotion' in part || 'intensity' in part) {
        applyEmotion();
        if (part.emotion && part.emotion !== prevEmotion && st.blinkStart < 0 && !reduce && cfg.blinking) st.nextBlink = Math.min(st.nextBlink, performance.now() + 380);
      }
      if ('follow' in part && !cfg.follow) { st.tx = 0; st.ty = 0; }
      dirty = true;
      if (st.frozen) draw(); else kick();
    }
    function layout() {
      var w = canvas.width, h = canvas.height;
      var phone = canvas.clientWidth < 600;
      var scale = Math.min(h / 3.45, w / (phone ? 7.2 : 7.2) * 2.0 / Math.max(cfg.sep, 1.6)) * cfg.zoom;
      // the face (cheeks to forehead) sits in the middle of the frame, eyes slightly below centre
      return { w: w, h: h, scale: scale, midX: w / 2, midY: Math.min(h * 0.80, h / 2 + 0.65 * scale) };
    }
    function aim(x, y) {
      if (!cfg.follow) return;
      var r = canvas.getBoundingClientRect();
      var dx = (x - (r.left + r.width / 2)) / (r.height * 1.4), dy = -(y - (r.top + r.height * 0.72)) / (r.height * 1.4);
      var m = Math.hypot(dx, dy), lim = 0.66;
      st.tx = m > lim ? dx / m * lim : dx; st.ty = (m > lim ? dy / m * lim : dy) * 0.62;
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
      if (cfg.follow) {
        var idle = now - st.lastPointer > 2600;
        if (!reduce && idle && now > st.nextGlance) {
          var back = Math.random() < 0.5;
          st.tx = back ? 0 : (Math.random() - 0.5) * 0.8; st.ty = back ? 0 : (Math.random() - 0.5) * 0.4;
          st.nextGlance = now + 1300 + Math.random() * 2400;
        }
      } else { st.tx = 0; st.ty = 0; }
      var tx = Math.max(-0.68, Math.min(0.68, st.tx + st.egx)), ty = Math.max(-0.40, Math.min(0.42, st.ty + st.egy));
      var dist = Math.hypot(tx - st.gx, ty - st.gy);
      var k = 1 - Math.exp(-dt / (reduce ? 260 : (dist > 0.12 ? 28 : 140)));
      st.gx += (tx - st.gx) * k; st.gy += (ty - st.gy) * k;
      if (!isFinite(st.gx) || !isFinite(st.gy)) { st.gx = tx; st.gy = ty; }
      if (reduce || (!cfg.blinking && st.blinkStart < 0)) { st.blink = 0; return; }
      if (cfg.blinking && st.blinkStart < 0 && now > st.nextBlink) st.blinkStart = now;
      if (st.blinkStart >= 0) {
        var b = blinkCurve(now - st.blinkStart, st.blinkSlow);
        if (b < 0) {
          st.blink = 0; st.blinkStart = -1;
          if (!st.double && Math.random() < 0.18) { st.double = true; st.nextBlink = now + 140; }
          else { st.double = false; st.nextBlink = now + (st.blinkSlow ? 1600 : 2400) + Math.random() * 4000; }
        } else st.blink = b;
      }
    }
    // Pixel budget: large monitors render at a slightly lower density instead of stalling.
    function resize() {
      var cw = Math.max(1, canvas.clientWidth), ch = Math.max(1, canvas.clientHeight);
      var dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(budget / (cw * ch)));
      var w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
      gl.viewport(0, 0, w, h);
    }
    function scaled(arr, k) { return arr.map(function (v) { return v * k; }); }
    function draw() {
      resize();
      var f = layout();
      var conv = 0.035;
      gl.uniform2f(U.uRes, f.w, f.h);
      gl.uniform2f(U.uMid, f.midX, f.midY);
      gl.uniform1f(U.uScale, f.scale);
      gl.uniform1f(U.uSep, cfg.sep);
      gl.uniform4f(U.uGaze, st.gx + conv, st.gy, st.gx - conv, st.gy);
      var a0 = cur.A0.slice(), a1 = cur.A1.slice(); a0[1] = st.blink; a1[1] = st.blink;
      gl.uniform4fv(U.uA0, a0); gl.uniform4fv(U.uA1, a1);
      gl.uniform4fv(U.uB0, scaled(cur.B0, cfg.browMotion)); gl.uniform4fv(U.uB1, scaled(cur.B1, cfg.browMotion));
      gl.uniform4fv(U.uC, cur.C);
      gl.uniform2f(U.uPupil, cur.pupil, cur.pupil);
      gl.uniform3fv(U.uSkin, skin.skin); gl.uniform3fv(U.uSSS, skin.sss); gl.uniform3fv(U.uSheen, skin.sheen);
      gl.uniform3fv(U.uBrowCol, hexToRgb(cfg.browColor)); gl.uniform3fv(U.uLidInner, skin.inner);
      gl.uniform3fv(U.uIrisTint, hexToRgb(cfg.irisColor)); gl.uniform1f(U.uIrisTintAmt, cfg.irisTint);
      gl.uniform1f(U.uDay, cfg.bg === 'day' ? 1 : 0); gl.uniform1f(U.uOptics, cfg.optics ? 1 : 0); gl.uniform1f(U.uGlow, cfg.glow);
      gl.uniform1f(U.uPresence, cfg.presence);
      gl.uniform4f(U.uBrow, cfg.browHeight, cfg.browArch, cfg.browTilt, cfg.browLength);
      gl.uniform3f(U.uBrowLook, cfg.browThick, cfg.browDensity, cfg.browStrength);
      gl.uniform1f(U.uOpenMul, cfg.eyeOpen); gl.uniform1f(U.uTilt, cfg.tilt);
      gl.uniform1f(U.uIrisScale, cfg.irisSize); gl.uniform1f(U.uPupilMul, cfg.pupil);
      gl.uniform1f(U.uSclera, cfg.sclera); gl.uniform1f(U.uCatch, cfg.catchlight);
      gl.uniform3f(U.uLash, cfg.lashLen, cfg.lashDensity, cfg.lashCurl);
      gl.uniform3f(U.uSkinLook, cfg.wrinkles, cfg.detail, cfg.gloss);
      gl.uniform3fv(U.uLidCol, hexToRgb(cfg.lidColor)); gl.uniform1f(U.uLidAmt, cfg.lidAmount);
      gl.uniform3f(U.uLight, cfg.lightAngle * Math.PI / 180, cfg.light, cfg.rim);
      gl.uniform1f(U.uHasIris, hasIris); gl.uniform1i(U.uIris, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // Frames are drawn only when something on screen changed.
    var raf = 0, last = performance.now(), visible = true, dirty = true, lastSig = '';
    // Adaptive resolution: when consecutive drawn frames come slower than ~30 fps, render fewer pixels.
    var budget = 2.4e6, drewLast = false, slowAvg = 16, slowN = 0;
    function signature() {
      var v = [st.gx, st.gy, st.blink, cur.pupil].concat(cur.A0, cur.A1, cur.B0, cur.B1, cur.C);
      for (var i = 0; i < v.length; i++) v[i] = Math.round(v[i] * 4000);
      return v.join(',');
    }
    function loop(now) {
      raf = 0;
      // rAF timestamps can precede the moment the loop was started: never step backwards in time
      var dt = Math.max(0, Math.min(64, now - last)); last = Math.max(last, now);
      step(now, dt);
      var sig = signature();
      resize();
      if (dirty || sig !== lastSig) {
        if (drewLast && dt > 0) {
          slowAvg += (dt - slowAvg) * 0.15; slowN++;
          if (slowN > 12 && slowAvg > 34 && budget > 0.5e6) { budget *= 0.7; slowN = 0; slowAvg = 16; }
        }
        dirty = false; lastSig = sig; draw(); drewLast = true;
      } else drewLast = false;
      if (visible && !document.hidden && !st.frozen) raf = requestAnimationFrame(loop);
    }
    function kick() { if (!raf && !st.frozen) { last = performance.now() - 16; raf = requestAnimationFrame(loop); } }
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; if (visible) kick(); }).observe(canvas);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
    applyEmotion();
    kick();

    return {
      setConfig: setConfig,
      getConfig: function () { return Object.assign({}, cfg); },
      blink: function () { if (st.blinkStart < 0) st.blinkStart = performance.now(); kick(); },
      // A PNG of the current frame on the given background colour.
      snapshot: function (bgColor) {
        draw();
        var out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
        var cx = out.getContext('2d'); cx.fillStyle = bgColor || '#0b1230'; cx.fillRect(0, 0, out.width, out.height);
        cx.drawImage(canvas, 0, 0);
        return out.toDataURL('image/png');
      },
      // Deterministic still frames for automated review.
      pose: function (gx, gy, blink) {
        cur = JSON.parse(JSON.stringify(tgt));
        st.frozen = true; st.gx = gx || 0; st.gy = gy || 0; st.blink = blink || 0; draw();
      },
      ready: function () { return hasIris === 1; },
      debugState: function () { return JSON.parse(JSON.stringify({ st: st, cur: cur })); }
    };
  }
  window.VijuEyeLab = { VERSION: 4.3, create: create, PRESETS: PRESETS, SKIN_PRESETS: SKIN_PRESETS, DEFAULTS: DEFAULTS };
})();
