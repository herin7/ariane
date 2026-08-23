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
import type { CompiledJourney, DerivedQuestion, Facts, JourneyStep } from "@ariane/core";

/**
 * Ariane on a phone.
 *
 * Two screens, because there are two questions: what do you want, and what do
 * you do about it. Everything the citizen sees came out of the compiler, and
 * every claim on the screen carries the source it was read off. Where there is
 * no source it says so instead of guessing.
 *
 * Deliberately plain. The UI is here to be usable, not admired.
 */

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
      <Text style={styles.h1}>Ariane</Text>
      <Text style={styles.sub}>
        Describe what you need in your own words. Gujarati, Hindi or English, either script.
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
          Read as: {result.understoodAs}
          {result.detectedLanguage ? ` (${result.detectedLanguage})` : ""}
        </Text>
      ) : null}

      {result && !result.matches.length && !error ? (
        <Text style={styles.muted}>
          Nothing in the graph matches that yet. We would rather say so than send you to the wrong
          office.
        </Text>
      ) : null}

      {result?.matches.map((m) => (
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
            {m.confidence < 0.3 ? "Best guess. " : ""}
            {m.matched.length ? `Matched: ${m.matched.join(", ")}` : "Read from the sentence, not the words"}
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
      <Text style={styles.sub}>
        {journey.jurisdiction.name}. Rules applied in order: {journey.jurisdiction.chain.join(" then ")}
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

      <View style={styles.stats}>
        {(
          [
            [s.stepsRemaining, "steps left"],
            [s.documentsToPrepareCount, "to prepare"],
            [s.documentsReadyCount, "you have"],
            [s.physicalVisits, "office visits"],
            [s.digitalChannels, "online"],
            [s.blockerCount, "blockers"],
          ] as [number, string][]
        ).map(([value, label]) => (
          <View key={label} style={styles.stat}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {journey.outstandingQuestions.length ? (
        <>
          <Text style={styles.h2}>Answer these and the path gets shorter</Text>
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
      {journey.orderedSteps.map((step) => (
        <Step key={step.nodeId} step={step} held={held} onHave={toggleHeld} />
      ))}

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

  return (
    <View style={[styles.card, step.state === "BLOCKED" && styles.blocked]}>
      <Text style={styles.h3}>
        {step.order}. {step.title}
        {step.state !== "READY" ? `  [${step.state.replace("_", " ").toLowerCase()}]` : ""}
      </Text>
      {step.officialName && step.officialName !== step.title ? (
        <Text style={styles.muted}>Officially: {step.officialName}</Text>
      ) : null}
      {step.whyRequired ? <Text style={styles.body}>{step.whyRequired}</Text> : null}
      {step.whatToDo ? <Text style={styles.body}>Do this: {step.whatToDo}</Text> : null}
      {step.expectedOutput ? <Text style={styles.body}>You get: {step.expectedOutput}</Text> : null}
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
  app: { flex: 1, backgroundColor: "#fff", paddingTop: 48 },
  page: { padding: 16, paddingBottom: 64, gap: 8 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  h1: { fontSize: 26, fontWeight: "700", color: "#111" },
  h2: { fontSize: 18, fontWeight: "700", color: "#111", marginTop: 20 },
  h3: { fontSize: 15, fontWeight: "600", color: "#111" },
  sub: { fontSize: 13, color: "#555" },
  body: { fontSize: 14, color: "#222", lineHeight: 20 },
  muted: { fontSize: 12, color: "#666", lineHeight: 17 },
  error: { fontSize: 14, color: "#a11", lineHeight: 20 },
  warn: { fontSize: 12, color: "#8a5a00", lineHeight: 17, fontWeight: "600" },
  link: { fontSize: 12, color: "#0645ad", textDecorationLine: "underline" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  grow: { flex: 1 },
  primary: { backgroundColor: "#111", borderRadius: 8, paddingVertical: 11, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "600" },
  small: { alignSelf: "flex-start", paddingVertical: 4 },
  smallText: { fontSize: 12, color: "#0645ad" },
  card: { borderWidth: 1, borderColor: "#e3e3e3", borderRadius: 10, padding: 12, gap: 4 },
  blocked: { borderColor: "#e0b4b4", backgroundColor: "#fdf6f6" },
  line: { gap: 2, marginTop: 4 },
  evidence: { borderLeftWidth: 3, borderLeftColor: "#ddd", paddingLeft: 8, marginTop: 6, gap: 2 },
  chipRow: { flexGrow: 0 },
  chipRowStatic: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  chipOn: { backgroundColor: "#111", borderColor: "#111" },
  chipText: { fontSize: 13, color: "#222" },
  chipOnText: { fontSize: 13, color: "#fff" },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  stat: { minWidth: 88 },
  statValue: { fontSize: 20, fontWeight: "700", color: "#111" },
  statLabel: { fontSize: 11, color: "#666" },
});
