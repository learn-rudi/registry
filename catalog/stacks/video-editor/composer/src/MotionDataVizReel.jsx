import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig
} from 'remotion';

const palette = {
  bg: '#0b0d0c',
  panel: '#111413',
  panel2: '#151917',
  ink: '#f3efe7',
  dim: '#a9a79d',
  faint: '#68665d',
  green: '#c9ff3a',
  terra: '#e86a33',
  gold: '#c9a24b',
  blue: '#74d6ff',
  hair: 'rgba(243, 239, 231, 0.14)',
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
      {children(frame - start)}
    </AbsoluteFill>
  );
}

function Shell({eyebrow, title, children, note}) {
  return (
    <div style={{position: 'absolute', left: 76, right: 76, top: 190}}>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 22,
          letterSpacing: 0,
          textTransform: 'uppercase',
          color: palette.green
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          marginTop: 30,
          fontFamily: fonts.serif,
          fontSize: 74,
          lineHeight: 1.02,
          letterSpacing: 0,
          color: palette.ink
        }}
      >
        {title}
      </div>
      <div style={{marginTop: 58}}>{children}</div>
      {note ? (
        <div
          style={{
            marginTop: 34,
            fontFamily: fonts.mono,
            fontSize: 18,
            letterSpacing: 0,
            textTransform: 'uppercase',
            color: palette.faint
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}

function Background() {
  return (
    <AbsoluteFill style={{backgroundColor: palette.bg}}>
      <AbsoluteFill
        style={{
          background: 'linear-gradient(180deg, rgba(17, 20, 19, 0.92), rgba(6, 8, 7, 1))'
        }}
      />
      <svg width="1080" height="1920" style={{position: 'absolute', inset: 0, opacity: 0.42}}>
        {Array.from({length: 16}, (_, index) => (
          <line
            key={`v-${index}`}
            x1={80 + index * 62}
            y1="0"
            x2={80 + index * 62}
            y2="1920"
            stroke={palette.softHair}
            strokeWidth="1"
          />
        ))}
        {Array.from({length: 21}, (_, index) => (
          <line
            key={`h-${index}`}
            x1="0"
            y1={120 + index * 82}
            x2="1080"
            y2={120 + index * 82}
            stroke={palette.softHair}
            strokeWidth="1"
          />
        ))}
      </svg>
    </AbsoluteFill>
  );
}

function CoverScene({localFrame}) {
  const title = progress(localFrame, 20, 26);
  const list = progress(localFrame, 58, 24);
  const items = ['Charts', 'Graphs', 'Tables', 'Matrices', 'Timelines', 'Controls'];

  return (
    <div style={{position: 'absolute', left: 78, right: 78, top: 430}}>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 22,
          letterSpacing: 0,
          textTransform: 'uppercase',
          color: palette.green
        }}
      >
        Motion graphic library
      </div>
      <div
        style={{
          marginTop: 36,
          fontFamily: fonts.serif,
          fontSize: 108,
          lineHeight: 0.98,
          color: palette.ink,
          opacity: title,
          transform: `translateY(${interpolate(title, [0, 1], [34, 0])}px)`
        }}
      >
        Data graphics
        <br />
        that explain.
      </div>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 58, opacity: list}}>
        {items.map((item, index) => (
          <div
            key={item}
            style={{
              height: 62,
              display: 'flex',
              alignItems: 'center',
              padding: '0 18px',
              border: `1px solid ${palette.hair}`,
              background: 'rgba(17, 20, 19, 0.74)',
              color: index < 2 ? palette.green : palette.ink,
              fontFamily: fonts.sans,
              fontSize: 26,
              fontWeight: 800
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

const barRows = [
  ['Collision map', 94, palette.green],
  ['Incentive wedge', 90, palette.green],
  ['Access cliff', 82, palette.terra],
  ['Role rows', 77, palette.gold],
  ['PIP proof', 62, palette.blue]
];

function BarChartScene({localFrame}) {
  return (
    <Shell
      eyebrow="01 / ranked bar chart"
      title={<>Rank what carries the argument.</>}
      note="Data contract: label, value, highlight"
    >
      <div style={{padding: '34px 34px 28px', background: 'rgba(17, 20, 19, 0.82)', border: `1px solid ${palette.hair}`}}>
        {barRows.map(([label, value, color], index) => {
          const reveal = easeOutCubic(progress(localFrame, 30 + index * 14, 24));
          const width = value * reveal;
          return (
            <div key={label} style={{marginBottom: 32}}>
              <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 12}}>
                <div style={{fontFamily: fonts.sans, color: palette.ink, fontSize: 27, fontWeight: 800}}>{label}</div>
                <div style={{fontFamily: fonts.mono, color, fontSize: 24}}>{Math.round(value * reveal)}</div>
              </div>
              <div style={{height: 18, background: 'rgba(243, 239, 231, 0.08)', overflow: 'hidden'}}>
                <div
                  style={{
                    width: `${width}%`,
                    height: '100%',
                    background: color,
                    boxShadow: color === palette.green ? '0 0 26px rgba(201, 255, 58, 0.25)' : 'none'
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

const linePoints = [
  [110, 640],
  [240, 620],
  [370, 585],
  [500, 545],
  [630, 500],
  [760, 430],
  [900, 350]
];

function LineChartScene({localFrame}) {
  const draw = easeInOutCubic(progress(localFrame, 42, 88));
  const threshold = progress(localFrame, 112, 24);
  const path = linePoints.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');

  return (
    <Shell
      eyebrow="02 / line graph"
      title={<>Show the moment the trend crosses.</>}
      note="Use when timing, thresholds, or acceleration matter"
    >
      <svg width="928" height="790" viewBox="0 0 928 790" style={{display: 'block'}}>
        <rect x="0" y="0" width="928" height="790" fill="rgba(17, 20, 19, 0.78)" stroke={palette.hair} />
        {[0, 1, 2, 3].map((row) => (
          <line key={row} x1="84" y1={170 + row * 120} x2="860" y2={170 + row * 120} stroke={palette.softHair} />
        ))}
        <line x1="84" y1="520" x2="860" y2="520" stroke={palette.terra} strokeWidth="2" opacity={0.2 + threshold * 0.65} />
        <text x="100" y="500" fill={palette.terra} fontFamily={fonts.mono} fontSize="22" opacity={threshold}>threshold</text>
        <path
          d={path}
          fill="none"
          stroke={palette.green}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - draw}
        />
        {linePoints.map(([x, y], index) => {
          const dot = progress(localFrame, 50 + index * 11, 12);
          const isLast = index === linePoints.length - 1;
          return (
            <circle
              key={`${x}-${y}`}
              cx={x}
              cy={y}
              r={isLast ? 9 : 6}
              fill={isLast ? palette.green : palette.ink}
              opacity={dot}
            />
          );
        })}
        <text x="86" y="660" fill={palette.faint} fontFamily={fonts.mono} fontSize="20">week 1</text>
        <text x="744" y="660" fill={palette.faint} fontFamily={fonts.mono} fontSize="20">week 7</text>
      </svg>
    </Shell>
  );
}

const tableRows = [
  ['Collision map', 'Mechanism', 'High', 'A+'],
  ['Access cliff', 'Timing', 'High', 'A'],
  ['Role rows', 'Structure', 'Medium', 'A'],
  ['PIP proof', 'Evidence', 'Medium', 'B+']
];

function TableScene({localFrame}) {
  return (
    <Shell
      eyebrow="03 / table scan"
      title={<>Make comparisons readable.</>}
      note="Keep vertical tables sparse and highlight one decision row"
    >
      <div style={{border: `1px solid ${palette.hair}`, background: 'rgba(17, 20, 19, 0.82)', overflow: 'hidden'}}>
        <div style={{display: 'grid', gridTemplateColumns: '1.35fr 1fr 0.8fr 0.45fr', background: 'rgba(232, 106, 51, 0.14)'}}>
          {['Primitive', 'Use', 'Lift', 'Fit'].map((heading) => (
            <div key={heading} style={{padding: '18px 16px', fontFamily: fonts.mono, fontSize: 17, color: palette.terra, textTransform: 'uppercase'}}>
              {heading}
            </div>
          ))}
        </div>
        {tableRows.map((row, rowIndex) => {
          const reveal = progress(localFrame, 34 + rowIndex * 18, 14);
          const selected = rowIndex === 0 && progress(localFrame, 116, 18) > 0.5;
          return (
            <div
              key={row[0]}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.35fr 1fr 0.8fr 0.45fr',
                borderTop: `1px solid ${palette.hair}`,
                opacity: reveal,
                background: selected ? 'rgba(201, 255, 58, 0.12)' : 'transparent'
              }}
            >
              {row.map((cell, index) => (
                <div
                  key={`${row[0]}-${cell}`}
                  style={{
                    padding: '22px 16px',
                    fontFamily: index === 0 ? fonts.sans : fonts.mono,
                    fontSize: index === 0 ? 24 : 19,
                    fontWeight: index === 0 ? 800 : 500,
                    color: index === 3 ? palette.green : palette.ink
                  }}
                >
                  {cell}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

const matrixPoints = [
  ['PIP', 270, 585, palette.blue],
  ['Table', 340, 390, palette.gold],
  ['Chart', 625, 354, palette.terra],
  ['Mechanism', 720, 206, palette.green]
];

function MatrixScene({localFrame}) {
  const reveal = progress(localFrame, 32, 28);
  const guideOpacity = 0.22 + reveal * 0.1;

  return (
    <Shell
      eyebrow="04 / matrix plot"
      title={<>Map priority by value and complexity.</>}
      note="Good for choosing what graphic to use next"
    >
      <svg width="928" height="820" viewBox="0 0 928 820" style={{display: 'block'}}>
        <rect width="928" height="820" fill="rgba(17, 20, 19, 0.8)" stroke={palette.hair} />
        <rect x="146" y="100" width="680" height="556" fill="none" stroke={palette.softHair} opacity={guideOpacity} />
        <line x1="486" y1="100" x2="486" y2="656" stroke={palette.softHair} opacity={0.18 * guideOpacity} />
        <line x1="146" y1="378" x2="826" y2="378" stroke={palette.softHair} opacity={0.18 * guideOpacity} />
        {matrixPoints.map(([label, x, y, color], index) => {
          const point = easeOutCubic(progress(localFrame, 58 + index * 18, 18));
          return (
            <g key={label} opacity={point}>
              <circle cx={x} cy={y} r={12 + (label === 'Mechanism' ? 5 : 0)} fill={color} />
              <text x={x + 18} y={y + 8} fill={palette.ink} fontFamily={fonts.sans} fontSize="26" fontWeight="800">{label}</text>
            </g>
          );
        })}
        <rect x="486" y="100" width="340" height="278" fill={palette.green} opacity={0.05 * reveal} />
      </svg>
    </Shell>
  );
}

const timelineItems = [
  ['1', 'Pick primitive'],
  ['2', 'Bind data'],
  ['3', 'Set highlight'],
  ['4', 'Scrub states'],
  ['5', 'Render MP4']
];

function TimelineScene({localFrame}) {
  return (
    <Shell
      eyebrow="05 / timeline"
      title={<>Interactive authoring, fixed export.</>}
      note="The viewer gets video. The creator gets controls."
    >
      <div style={{position: 'relative', height: 760, border: `1px solid ${palette.hair}`, background: 'rgba(17, 20, 19, 0.82)'}}>
        <div style={{position: 'absolute', left: 118, top: 90, bottom: 90, width: 2, background: palette.softHair}} />
        {timelineItems.map(([number, label], index) => {
          const reveal = progress(localFrame, 28 + index * 20, 16);
          return (
            <div
              key={label}
              style={{
                position: 'absolute',
                left: 78,
                right: 56,
                top: 74 + index * 124,
                display: 'grid',
                gridTemplateColumns: '80px 1fr',
                alignItems: 'center',
                opacity: reveal,
                transform: `translateX(${interpolate(reveal, [0, 1], [-28, 0])}px)`
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${index === 4 ? palette.green : palette.hair}`,
                  background: index === 4 ? 'rgba(201, 255, 58, 0.12)' : palette.panel,
                  color: index === 4 ? palette.green : palette.ink,
                  fontFamily: fonts.mono,
                  fontSize: 24
                }}
              >
                {number}
              </div>
              <div style={{marginLeft: 34, fontFamily: fonts.sans, color: palette.ink, fontSize: 34, fontWeight: 800}}>
                {label}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}

const controls = [
  ['Primitive', 'Matrix plot'],
  ['Dataset', 'Library candidates'],
  ['Highlight', 'Mechanism'],
  ['State', 'Frame 128'],
  ['Output', '1080x1920']
];

function ControlsScene({localFrame}) {
  return (
    <Shell
      eyebrow="06 / interactive controls"
      title={<>Build once. Reuse with new data.</>}
      note="Authoring controls become deterministic render props"
    >
      <div style={{display: 'grid', gridTemplateColumns: '1fr', gap: 16}}>
        {controls.map(([label, value], index) => {
          const reveal = progress(localFrame, 30 + index * 16, 14);
          const active = index === 2;
          return (
            <div
              key={label}
              style={{
                height: 92,
                display: 'grid',
                gridTemplateColumns: '190px 1fr',
                alignItems: 'center',
                padding: '0 28px',
                border: `1px solid ${active ? palette.green : palette.hair}`,
                background: active ? 'rgba(201, 255, 58, 0.1)' : 'rgba(17, 20, 19, 0.82)',
                opacity: reveal,
                transform: `translateY(${interpolate(reveal, [0, 1], [24, 0])}px)`
              }}
            >
              <div style={{fontFamily: fonts.mono, fontSize: 18, textTransform: 'uppercase', color: active ? palette.green : palette.faint}}>
                {label}
              </div>
              <div style={{fontFamily: fonts.sans, fontSize: 32, fontWeight: 850, color: palette.ink}}>
                {value}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 54,
          height: 122,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(201, 255, 58, 0.1)',
          border: `1px solid ${palette.green}`,
          color: palette.green,
          fontFamily: fonts.mono,
          fontSize: 26,
          opacity: progress(localFrame, 128, 18)
        }}
      >
        RENDER STATE LOCKED
      </div>
    </Shell>
  );
}

export function MotionDataVizReel() {
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
        <Scene start={120} end={270}>{(localFrame) => <BarChartScene localFrame={localFrame} />}</Scene>
        <Scene start={270} end={420}>{(localFrame) => <LineChartScene localFrame={localFrame} />}</Scene>
        <Scene start={420} end={570}>{(localFrame) => <TableScene localFrame={localFrame} />}</Scene>
        <Scene start={570} end={720}>{(localFrame) => <MatrixScene localFrame={localFrame} />}</Scene>
        <Scene start={720} end={870}>{(localFrame) => <TimelineScene localFrame={localFrame} />}</Scene>
        <Scene start={870} end={1020}>{(localFrame) => <ControlsScene localFrame={localFrame} />}</Scene>
      </div>
    </AbsoluteFill>
  );
}
