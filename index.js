<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PPCP Advanced</title>
    <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/minstyle.io@2.0.1/dist/css/minstyle.io.min.css">
    <style>
      .hide {
          display:none !important;
      }
      .spinner-container {
          width: 100px;
          height: 100px;
          display: flex;
          justify-content: center;
          align-items: center;
      }

      .div_input {
        display: inline-block;
        height: 40px;
        width: 100%;
        -webkit-appearance: none;
        -moz-appearance: none;
        appearance: none;
        -webkit-box-sizing: border-box;
        box-sizing: border-box;
        -webkit-box-shadow: none;
        box-shadow: none;
        font-size: 0.98rem;
        background-color: rgba(var(--main-bg), 1);
        border: 2px solid rgba(var(--default-border-color), 1);
        border-radius: var(--default-border-radius);
        margin: 0;
        padding: 0 0.8rem;
      }

      .spinner {
          border: 8px solid rgba(0, 0, 0, 0.1);
          border-top-color: lightblue;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          animation: spin 1s ease-in-out infinite;
      }

      @keyframes spin {
          to {
              transform: rotate(360deg);
          }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="row">
        <div class="col-sm"></div>
        <div class="col-sm">
          <h2 class="ms-text-center">ai-generated NFT Bored Ape</h2>
          <div class="ms-text-center pb-2">
            <div class="ms-label ms-large ms-action2 ms-light">$100.00 USD</div>
          </div>
          <div id="alerts" class="ms-text-center"></div>
          <div id="loading" class="spinner-container ms-div-center">
            <div class="spinner"></div>
          </div>
          <div id="content" class="hide">
            <div class="ms-card ms-fill">
              <div class="ms-card-content">
                <img src="https://cdn.discordapp.com/attachments/1060825015681028127/1076385063903694908/rauljr7_3d_e83fed6a-69aa-4a6a-b0ec-928edd57aecf.png" style="width:400px">
              </div>
            </div>
            <div id="payment_options">
              <form class="row ms-form-group" id="card-form">
              <div>
                <label for="card-number">Card Number</label>
                <div class="div_input" type="text" id="card-number"></div>
              </div>
              <div class="col-md mb-2">
                <label for="expiration-date">Expiration Date</label>
                <div id="expiration-date" class="div_input"></div>
              </div>
              <div class="col-md mb-2">
                <label for="cvv">Security Code</label>
                <div id="cvv" class="div_input"></div>
              </div>
              <div>
                <label for="email">Email</label>
                <input value placeholder="username@email.com" type="email" id="email" class="div_input" required>
              </div>
              <div><input class="ms-fullwidth mt-2 ms-medium" type="submit" value="Purchase"></div>
            </form>
              <hr><hr>
            </div>
          </div>
        </div>
        <div class="col-sm"></div>
        <footer style="margin-top:50px" class="ms-footer"> Footer Intentionally left empty :) </footer>
      </div>
    </div>

    <script>
      // Configuration - Update this URL to your deployed backend
      const BACKEND_URL = 'http://localhost:3000'; // Change this to your Render.com URL

      // Helper / Utility functions
      let current_customer_id;
      let order_id;
      let script_to_head = (attributes_object) => {
          return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            for (const name of Object.keys(attributes_object)) {
              script.setAttribute(name, attributes_object[name]);
            }
            document.head.appendChild(script);
            script.addEventListener('load', resolve);
            script.addEventListener('error', reject);
          });
      }
      let reset_purchase_button = () => {
          document.querySelector("#card-form").querySelector("input[type='submit']").removeAttribute("disabled");
          document.querySelector("#card-form").querySelector("input[type='submit']").value = "Purchase";
      }

      const is_user_logged_in = () => {
        return new Promise((resolve) => {
          current_customer_id = ""; // No localStorage usage
          resolve();
        });
      }

      const get_client_token = () => {
        return new Promise(async (resolve, reject) => {
          try {
            const response = await fetch(`${BACKEND_URL}/get_client_token`, {
              method: "POST", 
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ "customer_id": current_customer_id }),
            });

            const client_token = await response.text();
            resolve(client_token);
          } catch (error) {
            reject(error);
          }
        });
      }

      let handle_close = (event) => {
          event.target.closest(".ms-alert").remove();
      }
      let handle_click = (event) => {
          if (event.target.classList.contains("ms-close")) {
              handle_close(event);
          }
      }
      document.addEventListener("click", handle_click);

      const paypal_sdk_url = "https://www.paypal.com/sdk/js";
      const client_id = "REPLACE_WITH_YOUR_CLIENT_ID";
      const currency = "USD";
      const intent = "capture";

      let display_error_alert = () => {
          document.getElementById("alerts").innerHTML = `<div class="ms-alert ms-action2 ms-small"><span class="ms-close"></span><p>An Error Occurred! (View console for more info)</p></div>`;
      }

      let display_success_message = (object) => {
          order_details = object.order_details;
          paypal_buttons = object.paypal_buttons;
          console.log(order_details);
          let intent_object = intent === "authorize" ? "authorizations" : "captures";
          
          document.getElementById("alerts").innerHTML = `<div class='ms-alert ms-action'>Thank you ` + (order_details?.payer?.name?.given_name || ``) + ` ` + (order_details?.payer?.name?.surname || ``) + ` for your payment of ` + order_details.purchase_units[0].payments[intent_object][0].amount.value + ` ` + order_details.purchase_units[0].payments[intent_object][0].amount.currency_code + `!</div>`;

          paypal_buttons.close();
          document.getElementById("card-form").classList.add("hide");
      }

      //PayPal Code
      is_user_logged_in()
      .then(() => {
          return get_client_token();
      })
      .then((client_token) => {
          return script_to_head({"src": paypal_sdk_url + "?client-id=" + client_id + "&enable-funding=venmo&currency=" + currency + "&intent=" + intent + "&components=buttons,hosted-fields", "data-client-token": client_token})
      })
      .then(() => {
          document.getElementById("loading").classList.add("hide");
          document.getElementById("content").classList.remove("hide");
          let paypal_buttons = paypal.Buttons({
              onClick: (data) => {
                  // Custom JS here
              },
              style: {
                  shape: 'rect',
                  color: 'gold',
                  layout: 'vertical',
                  label: 'paypal'
              },

              createOrder: function(data, actions) {
                  return fetch(`${BACKEND_URL}/create_order`, {
                      method: "post", 
                      headers: { "Content-Type": "application/json; charset=utf-8" },
                      body: JSON.stringify({ "intent": intent })
                  })
                  .then((response) => response.json())
                  .then((order) => { return order.id; });
              },

              onApprove: function(data, actions) {
                  order_id = data.orderID;
                  console.log(data);
                  return fetch(`${BACKEND_URL}/complete_order`, {
                      method: "post", 
                      headers: { "Content-Type": "application/json; charset=utf-8" },
                      body: JSON.stringify({
                          "intent": intent,
                          "order_id": order_id
                      })
                  })
                  .then((response) => response.json())
                  .then((order_details) => {
                      display_success_message({"order_details": order_details, "paypal_buttons": paypal_buttons});
                   })
                   .catch((error) => {
                      console.log(error);
                      display_error_alert()
                   });
              },

              onCancel: function (data) {
                  document.getElementById("alerts").innerHTML = `<div class="ms-alert ms-action2 ms-small"><span class="ms-close"></span><p>Order cancelled!</p></div>`;
              },

              onError: function(err) {
                  console.log(err);
              }
          });
          paypal_buttons.render('#payment_options');
          
          // Hosted Fields
          if (paypal.HostedFields.isEligible()) {
              paypal_hosted_fields = paypal.HostedFields.render({
                createOrder: () => {
                  return fetch(`${BACKEND_URL}/create_order`, {
                      method: "post", 
                      headers: { "Content-Type": "application/json; charset=utf-8" },
                      body: JSON.stringify({ "intent": intent })
                  })
                  .then((response) => response.json())
                  .then((order) => { order_id = order.id; return order.id; });
                },
                styles: {
                  '.valid': {
                    color: 'green'
                  },
                  '.invalid': {
                    color: 'red'
                  },
                  'input': {
                      'font-size': '16pt',
                      'color': '#ffffff'
                  },
                },
                fields: {
                  number: {
                    selector: "#card-number",
                    placeholder: "4111 1111 1111 1111"
                  },
                  cvv: {
                    selector: "#cvv",
                    placeholder: "123"
                  },
                  expirationDate: {
                    selector: "#expiration-date",
                    placeholder: "MM/YY"
                  }
                }
              }).then((card_fields) => {
               document.querySelector("#card-form").addEventListener("submit", (event) => {
                  event.preventDefault();
                  document.querySelector("#card-form").querySelector("input[type='submit']").setAttribute("disabled", "");
                  document.querySelector("#card-form").querySelector("input[type='submit']").value = "Loading...";
                  card_fields
                    .submit({
                      cardholderName: "Raúl Uriarte, Jr.",
                      billingAddress: {
                        streetAddress: "123 Springfield Rd",
                        extendedAddress: "",
                        region: "AZ",
                        locality: "CHANDLER",
                        postalCode: "85224",
                        countryCodeAlpha2: "US",
                      },
                    })
                    .then(() => {
                      return fetch(`${BACKEND_URL}/complete_order`, {
                          method: "post", 
                          headers: { "Content-Type": "application/json; charset=utf-8" },
                          body: JSON.stringify({
                              "intent": intent,
                              "order_id": order_id,
                              "email": document.getElementById("email").value
                          })
                      })
                      .then((response) => response.json())
                      .then((order_details) => {
                          display_success_message({"order_details": order_details, "paypal_buttons": paypal_buttons});
                       })
                       .catch((error) => {
                          console.log(error);
                          display_error_alert();
                       });
                    })
                    .catch((err) => {
                      console.log(err);
                      reset_purchase_button();
                      display_error_alert();
                    });
                });
              });
            }
      })
      .catch((error) => {
          reset_purchase_button();
      });
    </script>
  </body>
</html>