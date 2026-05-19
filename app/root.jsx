import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

export default function App() {
  return (
    <html>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const originalAdd = EventTarget.prototype.addEventListener;
                const originalRemove = EventTarget.prototype.removeEventListener;
                EventTarget.prototype.addEventListener = function(type, listener, options) {
                  if (type === 'unload') {
                    originalAdd.call(this, 'pagehide', listener, options);
                  } else {
                    originalAdd.call(this, type, listener, options);
                  }
                };
                EventTarget.prototype.removeEventListener = function(type, listener, options) {
                  if (type === 'unload') {
                    originalRemove.call(this, 'pagehide', listener, options);
                  } else {
                    originalRemove.call(this, type, listener, options);
                  }
                };
              })();
            `
          }}
        />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
