import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { API, compileJourney, resolveIntent, type Resolved } from "./api";
// The subpath, not the package root. The root re-exports the graph seed, and
// Metro follows it: importing this one function from "@ariane/core" put every
// node, every source and 11471 verbatim government quotes inside the phone
// bundle, which is 5MB the citizen downloads and a second copy of the graph
// that can disagree with the server. journey.ts imports no data.
import { stageGroups } from "@ariane/core/journey";
// Types only, erased at build. These stay on the package root safely.
import type { CompiledJourney, DerivedQuestion, Facts, JourneyStep } from "@ariane/core";

/**
 * Ariane on a phone.
 *
 * Two screens, because there are two questions: what do you want, and what do
 * you do about it. Everything the citizen sees came out of the compiler, and
 * every claim on the screen carries the source it was read off. Where there is
 * no source it says so instead of guessing.
 *
 * The palette, the wording and the thread down the left of the path are the
 * same ones the web app uses. Not for tidiness: somebody who reads their
 * journey on a laptop and then opens it on a phone at the counter should not
 * have to work out whether they are looking at the same answer.
 */

/**
 * The web app's design tokens, which live in one block of custom properties in
 * apps/web/app/globals.css. React Native has no cascade, so they are copied
 * rather than shared, and this comment is the reason both files must move
 * together.
 */
const T = {
  bg: "#faf7f2",
  paper: "#fffefb",
  sunk: "#f4efe7",
  line: "#e9e1d5",
  lineStrong: "#d8ccb9",
  ink: "#191411",
  inkSoft: "#4a423b",
  muted: "#7a6f64",
  faint: "#9d9285",
  accent: "#bb3e11",
  accentSoft: "#fbeee7",
  accentLine: "#f0d6c7",
  good: "#1c7a4b",
  goodSoft: "#eaf5ee",
  warn: "#8f5c06",
  warnSoft: "#fbf1de",
  bad: "#ab2f20",
  badSoft: "#fbecea",
} as const;

export default function App() {
  const [goal, setGoal] = useState<{ id: string; name: string } | null>(null);

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      {goal ? <Journey goal={goal} onBack={() => setGoal(null)} /> : <Search onPick={setGoal} />}
    </View>
  );
}

function Search({ onPick }: { onPick: (goal: { id: string; name: string }) => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Resolved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await resolveIntent(text));
    } catch {
      setError(`Could not reach ${API}. Is the web app running?`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {/* §28. Same sentence the web landing page opens with. */}
      <Text style={styles.h1}>Government shouldn&rsquo;t{"\n"}feel this hard.</Text>
      <Text style={styles.lede}>
        Tell us what you need to get done, in your own words. Gujarati, Hindi or English, either
        script. We work out the order, the documents and the office, and we show you the government
        page every answer came from.
      </Text>

      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={search}
        placeholder="મારે આવકનો દાખલો જોઈએ છે"
        returnKeyType="search"
        autoCorrect={false}
      />
      <Pressable style={styles.primary} onPress={search} disabled={busy}>
        <Text style={styles.primaryText}>{busy ? "Looking" : "Find my path"}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {result?.understoodAs ? (
        <Text style={styles.muted}>
          Read from your sentence: <Text style={{ color: T.ink }}>{result.understoodAs}</Text>
          {result.detectedLanguage ? ` · ${result.detectedLanguage}` : ""}
        </Text>
      ) : null}

      {result && !result.matches.length && !error ? (
        <Text style={styles.muted}>
          Nothing in the graph matches that yet. We would rather say so than send you to the wrong
          office.
        </Text>
      ) : null}

      {result?.matches.length ? <Text style={styles.muted}>Looks like you need</Text> : null}

      {/* §5. Three at most. A ranked list of nine is the citizen doing the
          matching, which is the job they came here to hand over. §4: no
          confidence number reaches the screen, here or on the web. */}
      {result?.matches.slice(0, 3).map((m) => (
        <Pressable
          key={m.goal}
          style={styles.card}
          onPress={() => onPick({ id: m.goal.replace(/^service:/, ""), name: m.name })}
        >
          <Text style={styles.h3}>{m.name}</Text>
          {m.officialName && m.officialName !== m.name ? (
            <Text style={styles.muted}>Officially: {m.officialName}</Text>
          ) : null}
          <Text style={styles.muted}>
            {m.matched.length
              ? `because you said ${m.matched.join(", ")}`
              : "read between your words rather than off them, so check this is what you meant"}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Journey({ goal, onBack }: { goal: { id: string; name: string }; onBack: () => void }) {
  const [districts, setDistricts] = useState<string[]>([]);
  const [district, setDistrict] = useState("Ahmedabad");
  const [answers, setAnswers] = useState<Facts>({});
  const [held, setHeld] = useState<string[]>([]);
  const [journey, setJourney] = useState<CompiledJourney | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/jurisdictions?parent=IN-GJ`)
      .then((r) => r.json())
      .then((body: { jurisdictions: { name: string; level: string }[] }) =>
        setDistricts(body.jurisdictions.filter((j) => j.level === "DISTRICT").map((j) => j.name)),
      )
      .catch(() => undefined);
  }, []);

  // Every answer recompiles the whole journey on the server. There is no rule
  // logic on the phone, so the phone cannot disagree with the graph.
  useEffect(() => {
    let live = true;
    compileJourney(goal.id, district, answers, held)
      .then((j) => live && (setJourney(j), setError(null)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [goal.id, district, answers, held]);

  const toggleHeld = useCallback(
    (id: string) => setHeld((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id])),
    [],
  );

  if (error) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Back onPress={onBack} />
        <Text style={styles.error}>{error}</Text>
      </ScrollView>
    );
  }

  if (!journey) {
    return (
      <View style={[styles.page, styles.centre]}>
        <ActivityIndicator />
        <Text style={styles.muted}>Compiling your path</Text>
      </View>
    );
  }

  const s = journey.summary;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Back onPress={onBack} />
      <Text style={styles.h1}>{journey.goalName}</Text>
      {/* §29. The sentence a person needs before a list of eight things. */}
      <Text style={styles.lede}>
        You can do this. Here is the whole of it, in the order it actually happens.
      </Text>

      {districts.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {districts.map((d) => (
            <Pressable
              key={d}
              onPress={() => setDistrict(d)}
              style={[styles.chip, d === district && styles.chipOn]}
            >
              <Text style={d === district ? styles.chipOnText : styles.chipText}>{d}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* §7. Six numbers with labels under them is an analytics dashboard, and
          it told a citizen nothing they could act on. Same numbers, said the
          way somebody would say them, same wording as the web. */}
      <View style={styles.chipRowStatic}>
        {[
          `${s.stepsRemaining} step${s.stepsRemaining === 1 ? "" : "s"} left`,
          s.documentsToPrepareCount
            ? `${s.documentsToPrepareCount} document${s.documentsToPrepareCount === 1 ? "" : "s"} to prepare`
            : "",
          s.physicalVisits ? `${s.physicalVisits} office visit${s.physicalVisits === 1 ? "" : "s"}` : "",
          // physicalVisits counts government offices we hold an address for, so
          // this cannot promise nothing physical. It promises what it checked.
          s.digitalChannels && !s.physicalVisits ? "no government office to visit" : "",
        ]
          .filter(Boolean)
          .map((label) => (
            <View key={label} style={[styles.tag, { backgroundColor: T.accentSoft }]}>
              <Text style={[styles.tagText, { color: T.accent }]}>{label}</Text>
            </View>
          ))}
        {s.documentsReadyCount ? (
          <View style={[styles.tag, { backgroundColor: T.goodSoft }]}>
            <Text style={[styles.tagText, { color: T.good }]}>
              {s.documentsReadyCount} you already have
            </Text>
          </View>
        ) : null}
        {s.blockerCount ? (
          <View style={[styles.tag, { backgroundColor: T.badSoft }]}>
            <Text style={[styles.tagText, { color: T.bad }]}>
              {s.blockerCount} blocker{s.blockerCount === 1 ? "" : "s"}
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.faint}>
        {journey.jurisdiction.name}. Rules applied in order: {journey.jurisdiction.chain.join(" then ")}
      </Text>

      {journey.outstandingQuestions.length ? (
        <>
          {/* §6. How much is left, not which numbered step of a form you are on. */}
          <Text style={styles.h2}>
            We only need {journey.outstandingQuestions.length} more thing
            {journey.outstandingQuestions.length === 1 ? "" : "s"}
          </Text>
          <Text style={styles.muted}>We only ask what changes the graph. Nothing here is stored.</Text>
          {journey.outstandingQuestions.map((q) => (
            <Question
              key={q.field}
              question={q}
              onAnswer={(value) => setAnswers((a) => ({ ...a, [q.field]: value }))}
            />
          ))}
        </>
      ) : null}

      {journey.blockers.length ? (
        <>
          <Text style={styles.h2}>What is blocking you</Text>
          {journey.blockers.map((b) => (
            <View key={b.nodeId} style={[styles.card, styles.blocked]}>
              <Text style={styles.h3}>{b.title}</Text>
              <Text style={styles.body}>{b.reason}</Text>
              <Text style={styles.muted}>
                {b.actor === "CITIZEN"
                  ? "You can act on this."
                  : `This is with the ${b.actor.toLowerCase()}. Applying again will not move it.`}
              </Text>
              {b.resolution ? <Text style={styles.body}>{b.resolution}</Text> : null}
            </View>
          ))}
        </>
      ) : null}

      <Text style={styles.h2}>Your path</Text>
      {/* §8. The thread. One line down the left of the whole journey, with a
          knot at every step, because that is the brand and it is also the
          single clearest way to say "these are one continuous thing". */}
      <View style={styles.thread}>
        {stageGroups(journey.orderedSteps).map((g, _i, all) => (
          <View key={g.stage ?? "all"} style={{ gap: 8 }}>
            {all.length > 1 ? <Text style={styles.stageLabel}>{g.label}</Text> : null}
            {g.steps.map((step) => (
              <Step key={step.nodeId} step={step} held={held} onHave={toggleHeld} />
            ))}
          </View>
        ))}
      </View>

      <Text style={styles.h2}>If you get stuck</Text>
      {journey.helplines.length || journey.escalationPaths.length ? (
        <View style={styles.card}>
          {[...journey.helplines, ...journey.escalationPaths].map((c) => (
            <View key={c.nodeId} style={styles.line}>
              <Text style={styles.h3}>{c.name}</Text>
              {c.phoneNumbers?.map((p) => (
                <Link key={p} label={p} url={`tel:${p.replace(/[^+\d]/g, "")}`} />
              ))}
              {c.url ? <Link label={c.url} url={c.url} /> : null}
              {c.sources[0] ? (
                <Link label={c.sources[0].source.title} url={c.sources[0].source.url} />
              ) : (
                <Text style={styles.muted}>Not verified yet.</Text>
              )}
            </View>
          ))}
          <Text style={styles.muted}>
            Applying again does not restart a stalled file. A tracked grievance does.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.muted}>
            No escalation route verified for this service yet. We would rather say that than send you
            somewhere we have not checked.
          </Text>
        </View>
      )}

      <Text style={styles.h2}>How we worked this out</Text>
      <View style={styles.card}>
        {journey.trace.map((t, i) => (
          <Text key={i} style={styles.muted}>
            {t.stage}: {t.detail}
          </Text>
        ))}
      </View>

      {journey.warnings.map((w) => (
        <View key={w} style={[styles.card, styles.blocked]}>
          <Text style={styles.body}>{w}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Step({
  step,
  held,
  onHave,
}: {
  step: JourneyStep;
  held: string[];
  onHave: (id: string) => void;
}) {
  const [showSources, setShowSources] = useState(false);
  const facts = [step.fee && `Fee: ${step.fee}`, step.formNumber && `Form: ${step.formNumber}`, step.timeline]
    .filter(Boolean)
    .join("  ·  ");

  // §10. What a person should trust this step as far as, in three words.
  const trust = step.sources.some((s) => s.verificationStatus === "CONFLICTING")
    ? { bg: T.warnSoft, fg: T.warn, label: "Official sources disagree" }
    : step.machineExtracted
      ? { bg: T.warnSoft, fg: T.warn, label: "Machine extracted" }
      : step.sources.length
        ? { bg: T.goodSoft, fg: T.good, label: "Source verified" }
        : { bg: T.sunk, fg: T.muted, label: "Not verified yet" };

  return (
    <View style={[styles.card, step.state === "BLOCKED" && styles.blocked]}>
      {/* The knot. Its number only appears when a government page printed one:
          §11 forbids inventing a total order, so an unnumbered step gets a dot
          and says nothing about where it sits. */}
      <View
        style={[
          styles.knot,
          step.state === "SATISFIED" && { backgroundColor: T.good, borderColor: T.good },
          step.state === "BLOCKED" && { backgroundColor: T.bad, borderColor: T.bad },
          !step.orderVerified && step.state === "READY" && { borderColor: T.lineStrong },
        ]}
      >
        <Text
          style={[
            styles.knotText,
            (step.state === "SATISFIED" || step.state === "BLOCKED") && { color: "#fff" },
            !step.orderVerified && step.state === "READY" && { color: T.faint },
          ]}
        >
          {step.state === "SATISFIED" ? "✓" : step.orderVerified ? step.order : "•"}
        </Text>
      </View>

      <View style={[styles.chipRowStatic, { gap: 6 }]}>
        <View style={[styles.tag, { backgroundColor: trust.bg }]}>
          <Text style={[styles.tagText, { color: trust.fg }]}>{trust.label}</Text>
        </View>
        {step.state === "WAITING_EXTERNAL" ? (
          <View style={[styles.tag, { backgroundColor: T.sunk }]}>
            <Text style={[styles.tagText, { color: T.muted }]}>waiting external</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.h3}>{step.title}</Text>
      {step.officialName && step.officialName !== step.title ? (
        <Text style={styles.muted}>Officially: {step.officialName}</Text>
      ) : null}
      {step.description ? <Text style={styles.body}>{step.description}</Text> : null}
      {step.whyRequired ? <Text style={styles.body}>{step.whyRequired}</Text> : null}
      {step.whatToDo ? <Text style={styles.body}>Do this: {step.whatToDo}</Text> : null}
      {step.expectedOutput ? <Text style={styles.body}>You get: {step.expectedOutput}</Text> : null}
      {step.eligibility?.length ? (
        <>
          <Text style={styles.body}>The page says this about who qualifies:</Text>
          {step.eligibility.map((rule) => (
            <Text key={rule} style={styles.muted}>{"• " + rule}</Text>
          ))}
        </>
      ) : null}
      {step.couldBlock?.length ? (
        <>
          <Text style={styles.body}>What quietly stops this:</Text>
          {step.couldBlock.map((risk) => (
            <Text key={risk} style={styles.warn}>{"• " + risk}</Text>
          ))}
        </>
      ) : null}
      {facts ? <Text style={styles.muted}>{facts}</Text> : null}

      {step.documentsNeeded.map((d) => (
        <View key={d.nodeId} style={styles.line}>
          <Text style={styles.body}>
            {d.name}
            {d.alternatives?.length
              ? ` (${d.mode === "ANY_OF" ? "any one of" : d.mode === "AT_LEAST_N" ? `any ${d.minimumRequired} of` : "all of"}: ${d.alternatives.map((a) => a.name).join(", ")})`
              : ""}
            {d.producedByServiceId ? " (you get this from a step above)" : ""}
          </Text>
          {d.note ? <Text style={styles.muted}>{d.note}</Text> : null}
          <Pressable style={styles.small} onPress={() => onHave(d.nodeId)}>
            <Text style={styles.smallText}>{held.includes(d.nodeId) ? "undo" : "I have this"}</Text>
          </Pressable>
        </View>
      ))}

      {step.documentsReady.length ? (
        <Text style={styles.muted}>
          Already have: {step.documentsReady.map((d) => d.name).join(", ")}
        </Text>
      ) : null}

      {step.channels.map((c) => (
        <View key={`${c.nodeId}${c.via}`} style={styles.line}>
          <Text style={styles.muted}>{c.via.replace("_", " ").toLowerCase()}</Text>
          {c.url ? <Link label={c.name} url={c.url} /> : <Text style={styles.body}>{c.name}</Text>}
        </View>
      ))}

      {step.offices.map((o) => (
        // Not core's officeLine, on purpose. Importing a runtime helper drags
        // Metro into transpiling the workspace package for one string join.
        <View key={o.nodeId} style={styles.line}>
          <Text style={styles.body}>
            Visit: {[o.name, o.address, o.workingHours].filter(Boolean).join(", ")}
          </Text>
          {/* An address is exactly the kind of fact §41 says never to
              fabricate, so it carries its source or admits it has none. */}
          {o.sources[0] ? (
            <Link
              label={o.sources.some((s) => s.verificationStatus === "CONFLICTING") ? "sources disagree" : "source"}
              url={o.sources[0].source.url}
            />
          ) : (
            <Text style={styles.muted}>Not verified yet.</Text>
          )}
        </View>
      ))}

      {step.sources.length ? (
        <>
          {step.sources.some((s) => s.verificationStatus === "CONFLICTING") ? (
            // §42. Four government pages quote four different pension amounts.
            // Picking one silently would be the most damaging thing this
            // product could do, so say they disagree and show all of them.
            <Text style={styles.warn}>
              Official pages do not say the same thing here. Read all sides below before you rely on
              this.
            </Text>
          ) : null}
          <Pressable style={styles.small} onPress={() => setShowSources((v) => !v)}>
            <Text style={styles.smallText}>
              {showSources ? "Hide" : "Where this came from"} ({step.sources.length})
            </Text>
          </Pressable>
          {showSources
            ? step.sources.map((src, i) => (
                <View key={i} style={styles.evidence}>
                  {src.verificationStatus === "CONFLICTING" ? (
                    <Text style={styles.warn}>disputed</Text>
                  ) : null}
                  <Text style={styles.body}>“{src.evidence}”</Text>
                  <Link label={src.source.title} url={src.source.url} />
                  <Text style={styles.muted}>retrieved {src.source.retrievedAt}</Text>
                  {src.source.tlsVerified === false ? (
                    <Text style={styles.warn}>unverified certificate</Text>
                  ) : null}
                </View>
              ))
            : null}
        </>
      ) : (
        <Text style={styles.muted}>Not verified yet.</Text>
      )}
    </View>
  );
}

function Question({
  question,
  onAnswer,
}: {
  question: DerivedQuestion;
  onAnswer: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState("");
  const free = question.inputType !== "SINGLE_SELECT" && question.inputType !== "BOOLEAN";

  return (
    <View style={styles.card}>
      <Text style={styles.h3}>{question.label}</Text>
      {question.help ? <Text style={styles.muted}>{question.help}</Text> : null}

      {question.inputType === "SINGLE_SELECT" && question.options ? (
        <View style={styles.chipRowStatic}>
          {question.options.map((o) => (
            <Pressable key={o.value} style={styles.chip} onPress={() => onAnswer(o.value)}>
              <Text style={styles.chipText}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : question.inputType === "BOOLEAN" ? (
        <View style={styles.chipRowStatic}>
          <Pressable style={styles.chip} onPress={() => onAnswer(true)}>
            <Text style={styles.chipText}>Yes</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => onAnswer(false)}>
            <Text style={styles.chipText}>No</Text>
          </Pressable>
        </View>
      ) : null}

      {free ? (
        <View style={styles.chipRowStatic}>
          <TextInput
            style={[styles.input, styles.grow]}
            value={draft}
            onChangeText={setDraft}
            keyboardType={question.inputType === "NUMBER" ? "number-pad" : "default"}
          />
          <Pressable
            style={styles.primary}
            onPress={() => draft !== "" && onAnswer(question.inputType === "NUMBER" ? Number(draft) : draft)}
          >
            <Text style={styles.primaryText}>Answer</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.muted}>
        Changes {question.affects.length} thing{question.affects.length === 1 ? "" : "s"} in your path.
      </Text>
    </View>
  );
}

function Link({ label, url }: { label: string; url: string }) {
  return (
    <Text style={styles.link} onPress={() => Linking.openURL(url)}>
      {label}
    </Text>
  );
}

function Back({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.small} onPress={onPress}>
      <Text style={styles.smallText}>Back</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: T.bg, paddingTop: 48 },
  page: { padding: 18, paddingBottom: 72, gap: 10 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  h1: { fontSize: 30, fontWeight: "700", color: T.ink, letterSpacing: -0.7, lineHeight: 34 },
  h2: { fontSize: 13, fontWeight: "600", color: T.muted, letterSpacing: 0.3, marginTop: 24 },
  h3: { fontSize: 15.5, fontWeight: "600", color: T.ink, lineHeight: 21 },
  lede: { fontSize: 15.5, color: T.inkSoft, lineHeight: 22, marginBottom: 8 },
  body: { fontSize: 14, color: T.inkSoft, lineHeight: 20 },
  muted: { fontSize: 12.5, color: T.muted, lineHeight: 18 },
  faint: { fontSize: 12, color: T.faint, lineHeight: 17 },
  stageLabel: { fontSize: 11.5, fontWeight: "700", color: T.faint, letterSpacing: 0.8, marginTop: 12 },
  error: { fontSize: 14, color: T.bad, lineHeight: 20 },
  warn: { fontSize: 12.5, color: T.warn, lineHeight: 18, fontWeight: "600" },
  link: { fontSize: 12.5, color: T.accent, textDecorationLine: "underline" },
  input: {
    borderWidth: 1,
    borderColor: T.lineStrong,
    backgroundColor: T.paper,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: T.ink,
  },
  grow: { flex: 1 },
  primary: {
    backgroundColor: T.accent,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  primaryText: { color: "#fffefb", fontWeight: "600", fontSize: 15 },
  small: { alignSelf: "flex-start", paddingVertical: 5 },
  smallText: { fontSize: 12.5, color: T.accent },
  card: {
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.paper,
    borderRadius: 14,
    padding: 14,
    gap: 5,
  },
  blocked: { borderColor: "#f0c9c4", backgroundColor: T.badSoft },
  line: { gap: 2, marginTop: 5 },
  evidence: { borderLeftWidth: 2, borderLeftColor: T.accentLine, paddingLeft: 10, marginTop: 7, gap: 2 },
  chipRow: { flexGrow: 0 },
  chipRowStatic: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: {
    borderWidth: 1,
    borderColor: T.lineStrong,
    backgroundColor: T.paper,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipOn: { backgroundColor: T.ink, borderColor: T.ink },
  chipText: { fontSize: 13.5, color: T.inkSoft },
  chipOnText: { fontSize: 13.5, color: T.paper },
  tag: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  tagText: { fontSize: 11.5, fontWeight: "600" },

  // The thread, and the knots on it. The rail is a left border on the whole
  // path; each knot is pulled back out over it so it sits centred on the line.
  thread: { borderLeftWidth: 2, borderLeftColor: T.accentLine, paddingLeft: 24, marginLeft: 11, gap: 8 },
  knot: {
    position: "absolute",
    left: -37,
    top: 14,
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: T.accentLine,
    backgroundColor: T.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  knotText: { fontSize: 12, fontWeight: "700", color: T.accent },
});
