import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
export function NumberTicker({
  value,
  digits = 0,
  pad = 0,
  svg = false,
}: {
  value: number | undefined | null;
  digits?: number;
  pad?: number;
  svg?: boolean;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value ?? 0);
  const previous = useRef(display);
  previous.current = display;
  const lastTarget = useRef(value);
  const firstValue = value != null && lastTarget.current == null;
  useEffect(() => {
    if (value == null) {
      lastTarget.current = value;
      return;
    }
    const firstReading = lastTarget.current == null;
    lastTarget.current = value;
    if (reduced || firstReading) {
      setDisplay(value);
      return;
    }
    const animation = animate(previous.current, value, {
      duration: 0.15,
      ease: 'easeOut',
      onUpdate: setDisplay,
    });
    return () => animation.stop();
  }, [value, reduced]);
  const text =
    value == null ? '—' : (firstValue ? value : display).toFixed(digits).padStart(pad, '0');
  return svg ? <tspan>{text}</tspan> : <span>{text}</span>;
}
export function DecodeText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(text);
  useEffect(() => {
    if (reduced) {
      setDisplay(text);
      return;
    }
    let frame = 0;
    const timer = setInterval(() => {
      frame++;
      if (frame >= 5) {
        setDisplay(text);
        clearInterval(timer);
      } else
        setDisplay(
          text
            .split('')
            .map((c, i) =>
              i < (text.length * frame) / 5 || !/[A-Z0-9]/.test(c)
                ? c
                : '0123456789ABCDEF'[(i + frame * 3) % 16],
            )
            .join(''),
        );
    }, 55);
    return () => clearInterval(timer);
  }, [text, reduced]);
  return (
    <span aria-label={text}>
      <span aria-hidden="true">{display}</span>
    </span>
  );
}
