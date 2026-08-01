import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig
} from 'remotion';

const palette = {
  bg: '#0b0d0c',
  bgAlt: '#111413',
  ink: '#f3efe7',
  dim: '#a9a79d',
  faint: '#68665d',
  green: '#c9ff3a',
  terra: '#e86a33',
  gold: '#c9a24b',
  hair: 'rgba(243, 239, 231, 0.12)',
  softHair: 'rgba(243, 239, 231, 0.07)'
};

const fonts = {
  serif: 'Georgia, serif',
  sans: 'Inter, Arial, sans-serif',
  mono: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace'
};

const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);
const easeInOutCubic = (value) => (
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2
);

function clampInterpolate(frame, input, output) {
  return interpolate(frame, input, output, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });
}

function progress(frame, start, duration) {
  return clampInterpolate(frame, [start, start + duration], [0, 1]);
}

function sceneOpacity(frame, start, end, fade = 18) {
  const fadeIn = progress(frame, start, fade);
  const fadeOut = 1 - progress(frame, end - fade, fade);
  return Math.max(0, Math.min(1, fadeIn, fadeOut));
}

function Scene({start, end, children}) {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, start, end);

  if (opacity <= 0) {
    return null;
  }

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateY(${interpolate(opacity, [0, 1], [18, 0])}px)`,
        zIndex: start
      }}
    >
      {children(frame - start, opacity)}
    </AbsoluteFill>
  );
}

function Eyebrow({children, color = palette.dim, style = {}}) {
  return (
    <div
      style={{
        fontFamily: fonts.mono,
        fontSize: 24,
        letterSpacing: 5,
        textTransform: 'uppercase',
        color,
        ...style
      }}
    >
      {children}
    </div>
  );
}

const fieldNodes = Array.from({length: 36}, (_, index) => {
  const seed = (index * 9301 + 49297) % 233280;
  const x = 80 + (seed % 920);
  const y = 120 + ((seed * 37) % 1680);
  return {
    x,
    y,
    phase: (seed % 628) / 100,
    radius: 1.4 + (index % 4) * 0.5
  };
});

const fieldPairs = [];
for (let i = 0; i < fieldNodes.length; i += 1) {
  for (let j = i + 1; j < fieldNodes.length; j += 1) {
    const dx = fieldNodes[i].x - fieldNodes[j].x;
    const dy = fieldNodes[i].y - fieldNodes[j].y;
    if (Math.hypot(dx, dy) < 285) {
      fieldPairs.push([i, j]);
    }
  }
}

function ConstellationField() {
  const frame = useCurrentFrame();
  const points = fieldNodes.map((node, index) => ({
    x: node.x + Math.cos(frame * 0.012 + node.phase) * (8 + (index % 5) * 2),
    y: node.y + Math.sin(frame * 0.01 + node.phase) * (8 + (index % 6) * 2),
    radius: node.radius
  }));

  return (
    <svg
      width="1080"
      height="1920"
      style={{position: 'absolute', inset: 0, opacity: 0.55}}
    >
      {fieldPairs.map(([from, to], index) => {
        const a = points[from];
        const b = points[to];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const opacity = Math.max(0, 1 - distance / 285) * 0.15;

        return (
          <line
            key={`${from}-${to}-${index}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={palette.ink}
            strokeWidth="1"
            opacity={opacity}
          />
        );
      })}
      {points.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={point.radius}
          fill={palette.ink}
          opacity="0.25"
        />
      ))}
    </svg>
  );
}

function Background() {
  return (
    <AbsoluteFill style={{background: `linear-gradient(180deg, ${palette.bg}, ${palette.bgAlt} 55%, ${palette.bg})`}}>
      <ConstellationField />
      <AbsoluteFill
        style={{
          background: 'radial-gradient(130% 82% at 50% 38%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.58) 100%)'
        }}
      />
    </AbsoluteFill>
  );
}

function CoverScene({localFrame}) {
  const line = progress(localFrame, 22, 26);
  const sub = progress(localFrame, 56, 22);

  return (
    <div style={{position: 'absolute', left: 82, right: 82, top: 540}}>
      <Eyebrow color={palette.green}>Motion library</Eyebrow>
      <div
        style={{
          marginTop: 38,
          fontFamily: fonts.serif,
          fontSize: 112,
          lineHeight: 0.98,
          letterSpacing: 0,
          color: palette.ink,
          opacity: line,
          transform: `translateY(${interpolate(line, [0, 1], [28, 0])}px)`
        }}
      >
        Sophisticated
        <br />
        graphics are
        <br />
        <span style={{fontStyle: 'italic', color: palette.terra}}>systems.</span>
      </div>
      <div
        style={{
          marginTop: 46,
          maxWidth: 720,
          fontFamily: fonts.sans,
          fontSize: 34,
          lineHeight: 1.3,
          color: palette.dim,
          opacity: sub
        }}
      >
        The best ones explain structure, evidence, incentives, timing, and stakes.
      </div>
    </div>
  );
}

function ThesisCardScene({localFrame}) {
  const card = progress(localFrame, 20, 28);
  const highlight = progress(localFrame, 80, 18);

  return (
    <div style={{position: 'absolute', left: 84, right: 84, top: 430}}>
      <Eyebrow>01 / editorial thesis</Eyebrow>
      <div
        style={{
          marginTop: 42,
          padding: '56px 48px',
          border: `1px solid ${palette.hair}`,
          background: 'rgba(11, 13, 12, 0.84)',
          boxShadow: '0 28px 90px rgba(0,0,0,0.42)',
          opacity: card,
          transform: `translateY(${interpolate(card, [0, 1], [38, 0])}px)`
        }}
      >
        <div
          style={{
            fontFamily: fonts.serif,
            fontSize: 82,
            lineHeight: 1.04,
            letterSpacing: 0,
            color: palette.ink
          }}
        >
          The graphic does not decorate the point.
          <br />
          It <span style={{fontStyle: 'italic', color: highlight > 0.5 ? palette.green : palette.ink}}>is</span> the point.
        </div>
      </div>
      <div
        style={{
          marginTop: 34,
          fontFamily: fonts.mono,
          color: palette.faint,
          fontSize: 22,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
          opacity: progress(localFrame, 118, 18)
        }}
      >
        Best for serious explainers and policy arguments
      </div>
    </div>
  );
}

const roles = [
  ['01', 'Claim', 'The idea the viewer should remember.'],
  ['02', 'Proof', 'The receipt that makes it credible.'],
  ['03', 'Motion', 'The timing that makes it understandable.'],
  ['04', 'Takeaway', 'The line that earns the save.']
];

function RoleSystemScene({localFrame}) {
  return (
    <div style={{position: 'absolute', left: 86, right: 86, top: 260}}>
      <Eyebrow color={palette.terra}>02 / role system</Eyebrow>
      <div style={{marginTop: 38, borderBottom: `1px solid ${palette.hair}`}}>
        {roles.map(([number, title, copy], index) => {
          const row = progress(localFrame, 30 + index * 28, 18);
          return (
            <div
              key={title}
              style={{
                padding: '42px 0',
                borderTop: `1px solid ${palette.hair}`,
                opacity: row,
                transform: `translateY(${interpolate(row, [0, 1], [32, 0])}px)`
              }}
            >
              <div style={{display: 'flex', alignItems: 'baseline', gap: 28}}>
                <div
                  style={{
                    width: 88,
                    flexShrink: 0,
                    fontFamily: fonts.mono,
                    fontSize: 28,
                    letterSpacing: 2,
                    color: number === '04' ? palette.green : palette.terra
                  }}
                >
                  {number}
                </div>
                <div
                  style={{
                    fontFamily: fonts.serif,
                    fontSize: 78,
                    lineHeight: 0.95,
                    color: palette.ink
                  }}
                >
                  {title}
                </div>
              </div>
              <div
                style={{
                  marginTop: 16,
                  marginLeft: 116,
                  fontFamily: fonts.sans,
                  fontSize: 32,
                  lineHeight: 1.34,
                  color: palette.dim
                }}
              >
                {copy}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccessCliffScene({localFrame}) {
  const plateau = easeOutCubic(progress(localFrame, 34, 46));
  const drop = easeInOutCubic(progress(localFrame, 94, 32));
  const tail = easeOutCubic(progress(localFrame, 122, 30));
  const sweep = progress(localFrame, 128, 22);
  const x0 = 142;
  const xMid = 648;
  const x1 = 938;
  const yTop = 884;
  const yFloor = 1220;
  const yDrop = interpolate(drop, [0, 1], [yTop, yFloor]);
  const plateauEnd = interpolate(plateau, [0, 1], [x0, xMid]);
  const tailEnd = interpolate(tail, [0, 1], [xMid, x1]);
  const path = [
    `M ${x0} ${yTop}`,
    `L ${plateauEnd} ${yTop}`,
    plateau > 0.99 ? `L ${xMid} ${yDrop}` : '',
    drop > 0.99 ? `L ${tailEnd} ${yFloor}` : ''
  ].filter(Boolean).join(' ');

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <div style={{position: 'absolute', left: 86, right: 86, top: 280}}>
        <Eyebrow color={palette.green}>03 / access cliff</Eyebrow>
        <div
          style={{
            marginTop: 28,
            maxWidth: 760,
            fontFamily: fonts.serif,
            fontSize: 80,
            lineHeight: 1,
            color: palette.ink
          }}
        >
          Show the moment the switch flips.
        </div>
      </div>
      <svg width="1080" height="1920" style={{position: 'absolute', inset: 0}}>
        <line x1={x0} y1={yFloor} x2={x1} y2={yFloor} stroke={palette.hair} strokeWidth="1" />
        <line x1={xMid} y1={820} x2={xMid} y2={yFloor} stroke={palette.softHair} strokeWidth="1" strokeDasharray="6 9" />
        <path
          d={path}
          fill="none"
          stroke={palette.green}
          strokeWidth="4"
          strokeLinecap="butt"
        />
        <circle cx={xMid} cy={yTop} r={plateau > 0.86 ? 7 : 0} fill={palette.green} />
        <circle cx={xMid} cy={yTop} r={7 + sweep * 26} fill={palette.green} opacity={0.14 * sweep} />
        <line x1={x0} y1={interpolate(sweep, [0, 1], [yTop, yFloor])} x2={x1} y2={interpolate(sweep, [0, 1], [yTop, yFloor])} stroke={palette.green} strokeWidth="2" opacity={0.35 * sweep} />
      </svg>
      <div style={{position: 'absolute', left: x0, top: yTop - 48, fontFamily: fonts.mono, fontSize: 21, letterSpacing: 2, color: palette.dim, opacity: plateau}}>
        ACCESS
      </div>
      <div style={{position: 'absolute', left: xMid + 18, top: 832, fontFamily: fonts.mono, fontSize: 20, letterSpacing: 3, color: palette.terra, opacity: drop}}>
        TRIGGER
      </div>
      <div style={{position: 'absolute', right: 142, top: yFloor + 18, fontFamily: fonts.mono, fontSize: 21, letterSpacing: 2, color: palette.terra, opacity: drop}}>
        SUSPENDED
      </div>
    </div>
  );
}

function IncentiveWedgeScene({localFrame}) {
  const draw = easeOutCubic(progress(localFrame, 28, 64));
  const fill = progress(localFrame, 92, 30);
  const origin = {x: 160, y: 1060};
  const target = {x: 930, y: 1060};
  const top = {x: interpolate(draw, [0, 1], [origin.x, target.x]), y: interpolate(draw, [0, 1], [origin.y, 820])};
  const bottom = {x: interpolate(draw, [0, 1], [origin.x, target.x]), y: interpolate(draw, [0, 1], [origin.y, 1240])};

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <div style={{position: 'absolute', left: 86, right: 86, top: 300}}>
        <Eyebrow color={palette.terra}>04 / incentive wedge</Eyebrow>
        <div
          style={{
            marginTop: 28,
            maxWidth: 800,
            fontFamily: fonts.serif,
            fontSize: 78,
            lineHeight: 1.02,
            color: palette.ink
          }}
        >
          Make the tradeoff visible.
        </div>
      </div>
      <svg width="1080" height="1920" style={{position: 'absolute', inset: 0}}>
        <polygon points={`${origin.x},${origin.y} ${top.x},${top.y} ${bottom.x},${bottom.y}`} fill={palette.terra} opacity={0.13 * fill} />
        <line x1={origin.x} y1={origin.y} x2={top.x} y2={top.y} stroke={palette.terra} strokeWidth="4" />
        <line x1={origin.x} y1={origin.y} x2={bottom.x} y2={bottom.y} stroke={palette.dim} strokeWidth="4" />
        <circle cx={origin.x} cy={origin.y} r="8" fill={palette.ink} />
      </svg>
      <div style={{position: 'absolute', right: 104, top: 780, fontFamily: fonts.mono, fontSize: 21, letterSpacing: 2, color: palette.terra, opacity: fill}}>
        PROTECT VALUE
      </div>
      <div style={{position: 'absolute', right: 104, top: 1266, fontFamily: fonts.mono, fontSize: 21, letterSpacing: 2, color: palette.dim, opacity: fill}}>
        PROTECT USERS
      </div>
      <div
        style={{
          position: 'absolute',
          left: 456,
          top: 1032,
          fontFamily: fonts.mono,
          fontSize: 24,
          letterSpacing: 3,
          color: palette.green,
          opacity: progress(localFrame, 116, 20)
        }}
      >
        THE CONFLICT
      </div>
    </div>
  );
}

const collisionNodes = [
  ['REGULATOR', 540, 540],
  ['BUYER', 208, 1002],
  ['GATEKEEPER', 872, 1002],
  ['SHAREHOLDER', 540, 1454]
];

function CollisionMapScene({localFrame}) {
  const pull = easeInOutCubic(progress(localFrame, 76, 44));
  const reveal = progress(localFrame, 18, 40);
  const center = {x: 540, y: 1040};
  const landing = progress(localFrame, 126, 22);

  return (
    <div style={{position: 'absolute', inset: 0}}>
      <div style={{position: 'absolute', left: 86, top: 270}}>
        <Eyebrow>05 / collision map</Eyebrow>
      </div>
      <svg width="1080" height="1920" style={{position: 'absolute', inset: 0}}>
        {collisionNodes.map(([label, startX, startY], index) => {
          const x = interpolate(pull, [0, 1], [startX, center.x]);
          const y = interpolate(pull, [0, 1], [startY, center.y]);
          return (
            <React.Fragment key={label}>
              <line x1={center.x} y1={center.y} x2={x} y2={y} stroke={palette.terra} strokeWidth="2" opacity={0.3 + pull * 0.36} />
              <circle cx={x} cy={y} r={8} fill={index === 3 ? palette.green : palette.terra} opacity={reveal} />
            </React.Fragment>
          );
        })}
        <circle cx={center.x} cy={center.y} r={14 + landing * 36} fill={palette.green} opacity={0.12 * landing} />
        <circle cx={center.x} cy={center.y} r={8 + landing * 4} fill={palette.green} opacity={landing} />
      </svg>
      {collisionNodes.map(([label, startX, startY], index) => {
        const x = interpolate(pull, [0, 1], [startX, center.x]);
        const y = interpolate(pull, [0, 1], [startY, center.y]);
        const textOpacity = reveal * (1 - pull * 0.95);
        return (
          <div
            key={label}
            style={{
              position: 'absolute',
              left: x,
              top: y + 28,
              transform: 'translateX(-50%)',
              fontFamily: fonts.mono,
              fontSize: 23,
              letterSpacing: 2,
              whiteSpace: 'nowrap',
              color: index === 3 ? palette.green : palette.ink,
              opacity: textOpacity
            }}
          >
            {label}
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: 150,
          right: 150,
          top: 1130,
          textAlign: 'center',
          fontFamily: fonts.serif,
          fontSize: 76,
          lineHeight: 1.02,
          color: palette.ink,
          opacity: landing
        }}
      >
        one decision point
      </div>
    </div>
  );
}

const rankings = [
  ['A+', 'Collision map', 'many forces, one decision'],
  ['A+', 'Incentive wedge', 'structural conflict'],
  ['A', 'Access cliff', 'policy switch moment'],
  ['A', 'Role system', 'multi-part explanation'],
  ['A-', 'Thesis card', 'serious framing']
];

function RankingScene({localFrame}) {
  return (
    <div style={{position: 'absolute', left: 82, right: 82, top: 260}}>
      <Eyebrow color={palette.green}>Library ranking</Eyebrow>
      <div
        style={{
          marginTop: 34,
          fontFamily: fonts.serif,
          fontSize: 84,
          lineHeight: 1.02,
          color: palette.ink
        }}
      >
        Most sophisticated
        <br />
        when the graphic
        <br />
        explains the mechanism.
      </div>
      <div style={{marginTop: 54}}>
        {rankings.map(([grade, title, reason], index) => {
          const row = progress(localFrame, 58 + index * 15, 12);
          return (
            <div
              key={title}
              style={{
                height: 104,
                display: 'grid',
                gridTemplateColumns: '104px 1fr',
                alignItems: 'center',
                borderTop: `1px solid ${palette.hair}`,
                opacity: row,
                transform: `translateX(${interpolate(row, [0, 1], [-30, 0])}px)`
              }}
            >
              <div style={{fontFamily: fonts.serif, fontSize: 52, color: index < 2 ? palette.green : palette.terra}}>
                {grade}
              </div>
              <div>
                <div style={{fontFamily: fonts.sans, fontSize: 32, color: palette.ink, fontWeight: 800}}>
                  {title}
                </div>
                <div style={{marginTop: 8, fontFamily: fonts.mono, fontSize: 18, letterSpacing: 1.2, color: palette.faint, textTransform: 'uppercase'}}>
                  {reason}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MotionLibraryReel() {
  const {width, height} = useVideoConfig();
  const scale = Math.min(width / 1080, height / 1920);

  return (
    <AbsoluteFill style={{backgroundColor: '#000', overflow: 'hidden'}}>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 1080,
          height: 1920,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
          overflow: 'hidden',
          backgroundColor: palette.bg
        }}
      >
        <Background />
        <Scene start={0} end={120}>{(localFrame) => <CoverScene localFrame={localFrame} />}</Scene>
        <Scene start={120} end={240}>{(localFrame) => <ThesisCardScene localFrame={localFrame} />}</Scene>
        <Scene start={240} end={390}>{(localFrame) => <RoleSystemScene localFrame={localFrame} />}</Scene>
        <Scene start={390} end={540}>{(localFrame) => <AccessCliffScene localFrame={localFrame} />}</Scene>
        <Scene start={540} end={690}>{(localFrame) => <IncentiveWedgeScene localFrame={localFrame} />}</Scene>
        <Scene start={690} end={840}>{(localFrame) => <CollisionMapScene localFrame={localFrame} />}</Scene>
        <Scene start={840} end={990}>{(localFrame) => <RankingScene localFrame={localFrame} />}</Scene>
      </div>
    </AbsoluteFill>
  );
}
