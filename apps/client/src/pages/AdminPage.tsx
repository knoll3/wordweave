import React, { useEffect, useState } from "react";
import { resetLibrary } from "../lib/api";

const AdminPage: React.FC = () => {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("page-scrollable");

    return () => {
      document.body.classList.remove("page-scrollable");
    };
  }, []);

  function handleOpenConfirm() {
    setNotice(null);
    setError(null);
    setIsConfirmOpen(true);
  }

  function handleCloseConfirm() {
    if (isSubmitting) {
      return;
    }
    setIsConfirmOpen(false);
  }

  async function handleClearLibrary() {
    if (isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await resetLibrary();
      setNotice("Library cleared. Only the base items remain in the library.");
      setIsConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear library.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="cache-page">
      <header className="cache-page-header">
        <div>
          <div className="cache-page-label">Admin</div>
          <h1 className="cache-page-title">Library Admin</h1>
          <p className="clusters-page-copy">
            This page manages the discovered library list shown in the game UI. It does
            not clear recipe cache data.
          </p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="admin-panel-copy">
          Clear the discovered library list from the database and reset it back to the
          base items.
        </div>
        <button
          type="button"
          className="button danger"
          onClick={handleOpenConfirm}
          disabled={isSubmitting}
        >
          Clear Library
        </button>
        {notice ? <div className="admin-page-notice is-success">{notice}</div> : null}
        {error ? <div className="admin-page-notice is-error">{error}</div> : null}
      </section>

      {isConfirmOpen ? (
        <div className="confirm-overlay" role="presentation">
          <button
            type="button"
            className="confirm-backdrop"
            aria-label="Close clear library confirmation"
            onClick={handleCloseConfirm}
          />
          <div className="confirm-panel" role="dialog" aria-modal="true" aria-labelledby="clear-library-title">
            <h2 id="clear-library-title" className="confirm-title">
              Clear Library?
            </h2>
            <p className="confirm-text">
              This clears the discovered library list shown in the game and leaves the
              recipe cache untouched.
            </p>
            <p className="confirm-text confirm-metric">
              After clearing, only the base items will remain in the library.
            </p>
            <div className="confirm-actions">
              <button
                type="button"
                className="button"
                onClick={handleCloseConfirm}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => void handleClearLibrary()}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Clearing..." : "Confirm Clear"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AdminPage;
