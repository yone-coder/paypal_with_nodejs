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
    customer_id = localStorage.getItem("logged_in_user_id") || "";
    resolve();
  });
}

const get_client_token = () => {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch("/get_client_token", {
        method: "POST", headers: { "Content-Type": "application/json" },
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
const client_id = "AU23YbLMTqxG3iSvnhcWtix6rGN14uw3axYJgrDe8VqUVng8XiQmmeiaxJWbnpbZP_f4";
const currency = "USD";
const intent = "capture";

let display_error_alert = () => {
    document.getElementById("alerts").innerHTML = `<div class="ms-alert ms-action2 ms-small"><span class="ms-close"></span><p>An Error Ocurred! (View console for more info)</p>  </div>`;
}

let display_success_message = (object) => {
    order_details = object.order_details;
    paypal_buttons = object.paypal_buttons;
    console.log(order_details);
    let intent_object = intent === "authorize" ? "authorizations" : "captures";
    //Custom Successful Message
    document.getElementById("alerts").innerHTML = `<div class='ms-alert ms-action'>Thank you ` + (order_details?.payer?.name?.given_name || ``) + ` ` + (order_details?.payer?.name?.surname || ``) + ` for your payment of ` + order_details.purchase_units[0].payments[intent_object][0].amount.value + ` ` + order_details.purchase_units[0].payments[intent_object][0].amount.currency_code + `!</div>`;

    //Close out the PayPal buttons that were rendered
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
    //Handle loading spinner
    document.getElementById("loading").classList.add("hide");
    document.getElementById("content").classList.remove("hide");
    let paypal_buttons = paypal.Buttons({
        onClick: (data) => {
            //Custom JS here
        },
        style: {
            shape: 'rect',
            color: 'gold',
            layout: 'vertical',
            label: 'paypal'
        },

        createOrder: function(data, actions) {
            return fetch("/create_order", {
                method: "post", headers: { "Content-Type": "application/json; charset=utf-8" },
                body: JSON.stringify({ "intent": intent })
            })
            .then((response) => response.json())
            .then((order) => { return order.id; });
        },

        onApprove: function(data, actions) {
            order_id = data.orderID;
            console.log(data);
            return fetch("/complete_order", {
                method: "post", headers: { "Content-Type": "application/json; charset=utf-8" },
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
            document.getElementById("alerts").innerHTML = `<div class="ms-alert ms-action2 ms-small"><span class="ms-close"></span><p>Order cancelled!</p>  </div>`;
        },

        onError: function(err) {
            console.log(err);
        }
    });
    paypal_buttons.render('#payment_options');
    
    //Hosted Fields
    if (paypal.HostedFields.isEligible()) {
        paypal_hosted_fields = paypal.HostedFields.render({
          createOrder: () => {
            return fetch("/create_order", {
                method: "post", headers: { "Content-Type": "application/json; charset=utf-8" },
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
                return fetch("/complete_order", {
                    method: "post", headers: { "Content-Type": "application/json; charset=utf-8" },
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