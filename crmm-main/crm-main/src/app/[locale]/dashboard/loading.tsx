export default function DashboardLoading() {
  return (
    <main aria-busy="true" aria-label="Loading dashboard" className="workspace-shell">
      <aside aria-hidden="true" className="workspace-sidebar">
        <div className="ds-skeleton" style={{width: "118px", height: "34px"}} />
        <div className="ds-skeleton" style={{width: "100%", height: "52px", marginBlock: "26px"}} />
        <div className="dashboard-loading-panel">
          {Array.from({length: 5}, (_, index) => <div className="ds-skeleton" key={index} style={{width: `${72 + index % 2 * 16}%`, height: "34px"}} />)}
        </div>
      </aside>
      <section className="workspace-main">
        <header aria-hidden="true" className="workspace-topbar">
          <div className="ds-skeleton" style={{width: "180px", height: "14px"}} />
          <div className="ds-skeleton" style={{width: "92px", height: "32px"}} />
        </header>
        <div className="dashboard-content dashboard-loading">
          <div className="dashboard-loading-heading"><span className="ds-skeleton" style={{width: "90px", height: "12px"}} /><span className="ds-skeleton" style={{width: "210px", height: "29px"}} /></div>
          <div aria-hidden="true" className="dashboard-loading-metrics">
            {Array.from({length: 4}, (_, index) => <div key={index}><span className="ds-skeleton" style={{width: "68%", height: "12px"}} /><span className="ds-skeleton" style={{width: "42%", height: "27px"}} /><span className="ds-skeleton" style={{width: "82%", height: "10px"}} /></div>)}
          </div>
          <div aria-hidden="true" className="dashboard-loading-panels">
            {Array.from({length: 4}, (_, index) => <div className="dashboard-loading-panel" key={index}><span className="ds-skeleton" style={{width: "54%", height: "17px"}} /><span className="ds-skeleton" style={{width: "92%", height: "12px"}} /><span className="ds-skeleton" style={{width: "100%"}} /></div>)}
          </div>
        </div>
      </section>
    </main>
  );
}