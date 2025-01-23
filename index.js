const axios = require("axios");
const { google } = require("googleapis");
const { logMessage } = require("../utils/logger");
const { getProxyAgent } = require("./proxy");
const fs = require("fs");
const { EmailGenerator } = require("../utils/generator");
const path = require("path");
const TOKEN_PATH = path.join(__dirname, "../json/token.json");
const confEmail = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../json/client_secret.json"))
).email;
const qs = require("qs");

function loadOAuth2Client() {
  const credentials = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../json/client_secret.json"))
  );
  const { client_id, client_secret, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

class ariChain {
  constructor(refCode, proxy = null) {
    this.refCode = refCode;
    this.proxy = proxy;
    this.axiosConfig = {
      ...(this.proxy && { httpsAgent: getProxyAgent(this.proxy) }),
      timeout: 60000,
    };
    this.gmailClient = google.gmail({
      version: "v1",
      auth: loadOAuth2Client(),
    });
    this.baseEmail = confEmail;
  }

  async makeRequest(method, url, config = {}) {
    try {
      const response = await axios({
        method,
        url,
        ...this.axiosConfig,
        ...config,
      });
      return response;
    } catch (error) {
      logMessage(
        this.currentNum,
        this.total,
        `Request failed: ${error.message}`,
        "error"
      );
      if (this.proxy) {
        logMessage(
          this.currentNum,
          this.total,
          `Failed proxy: ${this.proxy}`,
          "error"
        );
      }
      return null;
    }
  }

  generateTempEmail() {
    const emailGenerator = new EmailGenerator(this.baseEmail);
    const tempEmail = emailGenerator.generateRandomVariation();
    logMessage(
      this.currentNum,
      this.total,
      `Created email: ${tempEmail}`,
      "success"
    );
    return tempEmail;
  }

  async sendEmailCode(email) {
    logMessage(
      this.currentNum,
      this.total,
      "Sending code to email...",
      "process"
    );
    const headers = {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
    };
    const data = qs.stringify({ email });
    const response = await this.makeRequest(
      "POST",
      "https://arichain.io/api/Email/send_valid_email",
      { headers, data }
    );
    if (!response) return false;
    logMessage(this.currentNum, this.total, "Email is available", "success");
    return true;
  }

  async getCodeVerification(tempEmail) {
    logMessage(
      this.currentNum,
      this.total,
      "Waiting for verification code...",
      "process"
    );

    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      logMessage(
        this.currentNum,
        this.total,
        `Attempt ${attempt + 1}`,
        "process"
      );

      logMessage(
        this.currentNum,
        this.total,
        "Waiting 10 seconds for a new message...",
        "warning"
      );
      await new Promise((resolve) => setTimeout(resolve, 10000));

      const messages = await this.gmailClient.users.messages.list({
        userId: "me",
        q: `to:${tempEmail}`,
      });

      if (messages.data.messages && messages.data.messages.length > 0) {
        const messageId = messages.data.messages[0].id;
        const message = await this.gmailClient.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });

        const emailBody = message.data.payload.body.data;
        if (emailBody) {
          const decodedBody = Buffer.from(emailBody, "base64").toString(
            "utf-8"
          );

          const codeMatch = decodedBody.match(/\b\d{6}\b/);
          if (codeMatch) {
            const verificationCode = codeMatch[0];
            logMessage(
              this.currentNum,
              this.total,
              `Verification code found: ${verificationCode}`,
              "success"
            );
            return verificationCode;
          }
        }
      }

      logMessage(
        this.currentNum,
        this.total,
        "Code not available. Waiting 5 seconds before trying again...",
        "warning"
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    logMessage(
      this.currentNum,
      this.total,
      "Failed to get verification code after several attempts.",
      "error"
    );
    return null;
  }

  async checkinDaily(address) {
    const headers = {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
    };
    const data = qs.stringify({ address });
    const response = await this.makeRequest(
      "POST",
      "https://arichain.io/api/event/checkin",
      {
        headers,
        data,
      }
    );
    if (!response) {
      logMessage(this.currentNum, this.total, "Check-in failed", "error");
      return null;
    }
    return response.data;
  }
  async transferToken(email, toAddress, password, amount = 60) {
    const headers = {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
    };
    const transferData = qs.stringify({
      email,
      to_address: toAddress,
      pw: password,
      amount,
    });
    const response = await this.makeRequest(
      "POST",
      "https://arichain.io/api/wallet/transfer_mobile",
      {
        headers,
        data: transferData,
      }
    );
    if (!response) {
      logMessage(this.currentNum, this.total, "Failed to send token", "error");
      return null;
    }
    return response.data;
  }

  async registerAccount(email, password) {
    logMessage(this.currentNum, this.total, "Registering account...", "process");

    const verifyCode = await this.getCodeVerification(email);
    if (!verifyCode) {
      logMessage(
        this.currentNum,
        this.total,
        "Failed to get verification code. Registration canceled.",
        "error"
      );
      return null;
    }

    const headers = {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded",
    };

    const registerData = qs.stringify({
      email: email,
      pw: password,
      pw_re: password,
      valid_code: verifyCode,
      invite_code: this.refCode,
    });

    const response = await this.makeRequest(
      "POST",
      "https://arichain.io/api/Account/signup",
      {
        headers,
        data: registerData,
      }
    );

    if (response.data.status === "fail") {
      logMessage(this.currentNum, this.total, response.data.msg, "error");
      return null;
    }

    logMessage(this.currentNum, this.total, "Account registration succeeded", "success");

    return response.data;
  }
}

module.exports = ariChain;