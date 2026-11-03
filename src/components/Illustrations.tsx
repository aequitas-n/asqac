export function CapsuleDrawing({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 400 440"
      fill="none"
      role="img"
      aria-label="Illustration of the ASQAC specimen capsule with three test tubes"
    >
      <ellipse cx="203" cy="386" rx="98" ry="14" fill="#d9e5e3" />
      <g transform="rotate(12 200 225)">
        <path
          d="M119 119V316C119 363 281 363 281 316V119"
          fill="#f6faf9"
          stroke="#90aca9"
          strokeWidth="2"
        />
        <ellipse
          cx="200"
          cy="119"
          rx="81"
          ry="24"
          fill="#dbeae6"
          stroke="#90aca9"
          strokeWidth="2"
        />
        <ellipse cx="200" cy="121" rx="62" ry="15" fill="#edf4f1" stroke="#b9ccc6" />
        <g stroke="#a5b9b3" strokeWidth="2">
          <rect x="148" y="158" width="26" height="146" rx="12" fill="white" />
          <rect x="187" y="149" width="26" height="153" rx="12" fill="white" />
          <rect x="226" y="158" width="26" height="146" rx="12" fill="white" />
        </g>
        <path d="M153 231H169V290C169 300 153 300 153 290V231Z" fill="#e8b2a2" />
        <path d="M192 213H208V290C208 300 192 300 192 290V213Z" fill="#d8c1a1" />
        <path d="M231 236H247V290C247 300 231 300 231 290V236Z" fill="#b3d3c5" />
        <rect x="145" y="153" width="32" height="20" rx="5" fill="#0e6e73" />
        <rect x="184" y="144" width="32" height="20" rx="5" fill="#c18372" />
        <rect x="223" y="153" width="32" height="20" rx="5" fill="#0e6e73" />
        <path
          d="M119 297C119 327 281 327 281 297V329C281 371 119 371 119 329V297Z"
          fill="#0e6e73"
          stroke="#0b5659"
          strokeWidth="2"
        />
        <ellipse
          cx="200"
          cy="298"
          rx="81"
          ry="22"
          fill="#1b8585"
          stroke="#0b6568"
          strokeWidth="2"
        />
        <path
          d="M127 112V88C127 42 273 42 273 88V112C273 139 127 139 127 112Z"
          fill="#0e6e73"
          stroke="#0b5659"
          strokeWidth="2"
        />
        <ellipse cx="200" cy="83" rx="73" ry="22" fill="#218787" stroke="#0b6568" strokeWidth="2" />
        <path d="M144 136V280" stroke="white" strokeWidth="7" strokeLinecap="round" />
        <rect x="183" y="324" width="34" height="5" rx="2.5" fill="#bbdfd5" />
      </g>
      <path d="M92 178H53V153" stroke="#9bb8b0" strokeWidth="1.5" />
      <circle cx="91" cy="178" r="3" fill="#0e6e73" />
      <path d="M294 268H338V299" stroke="#9bb8b0" strokeWidth="1.5" />
      <circle cx="294" cy="268" r="3" fill="#0e6e73" />
      <g fill="#54776e" fontFamily="var(--mono)" fontSize="9">
        <text x="27" y="145">
          SENSOR SUITE
        </text>
        <text x="288" y="316">
          REUSABLE CAPSULE
        </text>
      </g>
    </svg>
  );
}
export function EmptyDrawing() {
  return (
    <svg viewBox="0 0 120 90" width="120" height="90" fill="none" aria-hidden="true">
      <path d="M17 75H103" stroke="#dce6e2" strokeWidth="2" strokeLinecap="round" />
      <rect
        x="40"
        y="13"
        width="40"
        height="60"
        rx="17"
        fill="#f1f7f4"
        stroke="#a3beb4"
        strokeWidth="1.5"
      />
      <path d="M40 42H80" stroke="#a3beb4" strokeWidth="1.5" />
      <rect x="53" y="24" width="14" height="3" rx="1.5" fill="#0e6e73" />
      <path
        d="M25 28C18 35 18 47 25 54M94 28C101 35 101 47 94 54"
        stroke="#bdd0c8"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M17 21C6 32 6 50 17 61M103 21C114 32 114 50 103 61"
        stroke="#d5e1dc"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="60" cy="56" r="4" fill="#d8e9df" />
    </svg>
  );
}
