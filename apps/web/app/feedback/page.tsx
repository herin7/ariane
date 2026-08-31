import type { Metadata } from "next";
import { FeedbackForm } from "./form";
import styles from "./feedback.module.css";

/**
 * The one page where Ariane listens instead of answering.
 *
 * Coverage is the whole product and the gap in it is invisible from the inside:
 * we know which services are sourced, not which ones somebody went looking for
 * and did not find. This page is the only way that second list gets written.
 */

export const metadata: Metadata = {
  title: "Reviews and requests",
  description: "Tell us what to fix, or ask for a service Ariane does not cover yet.",
};

export default function FeedbackPage() {
  return (
    <div className={styles.page}>
      <h1>Tell us what is missing</h1>
      <p>
        A review, or a service you went looking for and did not find. No account needed. Anything you ask for gets
        researched against an official source before it goes in, so it will not appear overnight.
      </p>
      <FeedbackForm />
    </div>
  );
}
