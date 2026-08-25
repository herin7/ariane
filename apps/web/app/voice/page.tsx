import { TalkToAriane } from "./talk";

/**
 * `/voice`. A page of its own, deliberately.
 *
 * The panel is meant to sit on the home page and beside a journey, and it will
 * once the UI work in flight lands - it is a component and mounting it is one
 * line. Until then this is a real address a citizen or a judge can open, and it
 * is not blocked on anybody else's file.
 *
 *   import { TalkToAriane } from "./voice/talk";
 *   <TalkToAriane district={district} />
 *
 * It renders nothing at all when the deployment has no voice keys, so it is
 * safe to mount unconditionally.
 */
export const metadata = {
  title: "Talk to Ariane",
  description: "Ask about a government service out loud, in Gujarati, Hindi or English.",
};

export default function VoicePage() {
  return (
    <div className="reading-page">
      <p className="page-eyebrow">Voice</p>
      <h1>Talk to Ariane</h1>
      <p className="lede">
        Say what you need to get done. Ariane answers from the same graph the rest of this site is
        built on, cites the page every fee and timeline came from, and says so when it does not
        know.
      </p>

      <TalkToAriane />

      <p className="small muted" style={{ marginTop: 20 }}>
        Nothing from this call is recorded or kept. Ariane remembers only what you ask it to, and
        you can ask it to forget at any time.
      </p>
    </div>
  );
}
