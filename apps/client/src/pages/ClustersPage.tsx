import React, { useEffect, useMemo, useState } from "react";
import { fetchSemanticClusters } from "../lib/api";
import type { SemanticCluster, SemanticClustersResponse } from "../types";

function formatMembership(value: number) {
  return `${Math.round(value * 100)}%`;
}

const ClustersPage: React.FC = () => {
  const [data, setData] = useState<SemanticClustersResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("page-scrollable");

    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        const next = await fetchSemanticClusters();
        if (cancelled) {
          return;
        }
        setData(next);
        setActiveClusterId(next.clusters[0]?.id ?? null);
        setError(null);
      } catch (err) {
        console.error("[clusters] failed to load semantic clusters", err);
        if (!cancelled) {
          setError("Failed to load semantic clusters.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      document.body.classList.remove("page-scrollable");
    };
  }, []);

  const activeCluster = useMemo(
    () => data?.clusters.find((cluster) => cluster.id === activeClusterId) ?? null,
    [activeClusterId, data]
  );

  return (
    <div className="clusters-page">
      <header className="clusters-page-header">
        <div>
          <div className="clusters-page-label">Semantic Library Map</div>
          <h1 className="clusters-page-title">Dynamic Clusters</h1>
          <p className="clusters-page-copy">
            Discovered items are grouped by embedding similarity into a small set of
            reusable semantic neighborhoods.
          </p>
        </div>
        <div className="clusters-page-actions">
          <a className="button" href="/">
            Back To Workspace
          </a>
          <a className="button" href="/cache">
            View Cache
          </a>
        </div>
      </header>

      {isLoading ? (
        <div className="clusters-page-empty">Building semantic clusters...</div>
      ) : error ? (
        <div className="clusters-page-empty">{error}</div>
      ) : !data || data.clusters.length === 0 ? (
        <div className="clusters-page-empty">
          Not enough discovered items are available to form clusters yet.
        </div>
      ) : (
        <>
          <section className="clusters-overview">
            <div className="clusters-stat-card">
              <span className="clusters-stat-label">Items</span>
              <strong>{data.totalItems}</strong>
            </div>
            <div className="clusters-stat-card">
              <span className="clusters-stat-label">Major Clusters</span>
              <strong>{data.clusterCount}</strong>
            </div>
            <div className="clusters-stat-card">
              <span className="clusters-stat-label">Overlap Items</span>
              <strong>{data.overlapItemCount}</strong>
            </div>
            <div className="clusters-stat-card">
              <span className="clusters-stat-label">Generated</span>
              <strong>{new Date(data.generatedAt).toLocaleTimeString()}</strong>
            </div>
          </section>

          <div className="clusters-layout">
            <section className="clusters-list">
              {data.clusters.map((cluster) => (
                <button
                  key={cluster.id}
                  type="button"
                  className={`clusters-list-card${
                    activeCluster?.id === cluster.id ? " is-active" : ""
                  }`}
                  onClick={() => setActiveClusterId(cluster.id)}
                >
                  <div className="clusters-list-header">
                    <div className="clusters-list-title">{cluster.title}</div>
                    <div className="clusters-list-count">{cluster.primaryMemberCount}</div>
                  </div>
                  <div className="clusters-list-summary">{cluster.summary}</div>
                  <div className="clusters-list-chip-row">
                    {cluster.representativeItems.map((item) => (
                      <span key={`${cluster.id}-${item.id}`} className="clusters-mini-chip">
                        {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
                        <span>{item.name}</span>
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </section>

            {activeCluster ? (
              <section className="clusters-detail">
                <div className="clusters-detail-header">
                  <div>
                    <div className="clusters-detail-label">Selected Cluster</div>
                    <h2 className="clusters-detail-title">{activeCluster.title}</h2>
                    <p className="clusters-detail-summary">{activeCluster.summary}</p>
                  </div>
                  <div className="clusters-detail-meta">
                    <span>{activeCluster.primaryMemberCount} primary items</span>
                    <span>{activeCluster.memberCount} total memberships</span>
                  </div>
                </div>

                <div className="clusters-member-grid">
                  {activeCluster.members.map((item) => (
                    <article
                      key={`${activeCluster.id}-${item.id}-${item.isPrimary ? "p" : "s"}`}
                      className={`clusters-member-card${
                        item.isPrimary ? "" : " is-secondary"
                      }`}
                    >
                      <div className="clusters-member-top">
                        <span className="clusters-member-icon" aria-hidden="true">
                          {item.icon || item.name.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <div className="clusters-member-name">{item.name}</div>
                          <div className="clusters-member-meta">
                            {item.isPrimary ? "Primary member" : "Secondary member"}
                          </div>
                        </div>
                      </div>
                      <div className="clusters-member-strength">
                        Fit {formatMembership(item.membershipStrength)}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};

export default ClustersPage;
