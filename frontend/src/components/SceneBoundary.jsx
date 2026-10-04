import { Component } from "react";
export default class SceneBoundary extends Component {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error("OrbitWatch scene failed", error); this.props.onReady?.(); }
  render() {
    if (this.state.failed) return <div className="scene-error" role="alert"><h2>The 3D scene is unavailable.</h2><p>Try a lower render quality or close other graphics-heavy tabs. Your session and catalog remain usable.</p><button onClick={() => { this.props.onReset?.(); this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1 })); }}>RETRY SCENE</button></div>;
    return <div key={this.state.attempt} className="scene-boundary">{this.props.children}</div>;
  }
}
