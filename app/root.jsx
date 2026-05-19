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
                function patchAddEventListener(obj) {
                  if (!obj || !obj.addEventListener) return;
                  const originalAdd = obj.addEventListener;
                  const originalRemove = obj.removeEventListener;
                  obj.addEventListener = function(type, listener, options) {
                    if (type === 'unload') {
                      originalAdd.call(this, 'pagehide', listener, options);
                    } else {
                      originalAdd.call(this, type, listener, options);
                    }
                  };
                  obj.removeEventListener = function(type, listener, options) {
                    if (type === 'unload') {
                      originalRemove.call(this, 'pagehide', listener, options);
                    } else {
                      originalRemove.call(this, type, listener, options);
                    }
                  };
                }
                
                patchAddEventListener(EventTarget.prototype);
                patchAddEventListener(window);
                patchAddEventListener(document);
                
                if (typeof Object.defineProperty === 'function') {
                  Object.defineProperty(window, 'onunload', {
                    configurable: true,
                    enumerable: true,
                    set: function(listener) {
                      window.addEventListener('pagehide', listener);
                    },
                    get: function() { return null; }
                  });
                }
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
