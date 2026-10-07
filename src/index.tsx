/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "./adapter/views/styles/global.css";
import "./adapter/views/styles/dashboard.css";
import "./adapter/views/styles/master.css";
import "./adapter/views/styles/review.css";
import "./adapter/views/styles/pages.css";

render(() => <App />, document.getElementById("root") as HTMLElement);
