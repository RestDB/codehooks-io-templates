/*
Go Webhook Receiver Example

Installation:
	go get github.com/gorilla/mux

Usage:
	export WEBHOOK_SECRET="whsec_your_secret_here"
	go run receiver-go.go
*/

package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

var webhookSecret string

type Event struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Data    map[string]interface{} `json:"data"`
	Created int64                  `json:"created"`
}

type VerificationRequest struct {
	Type              string `json:"type"`
	VerificationToken string `json:"verification_token"`
	Challenge         string `json:"challenge"`
	Created           int64  `json:"created"`
}

type ChallengeResponse struct {
	Challenge string `json:"challenge"`
}

func verifyWebhookSignature(payload []byte, signature string, timestamp string) bool {
	// Reject old requests (older than 5 minutes)
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}

	currentTime := time.Now().Unix()
	if currentTime-ts > 300 || ts-currentTime > 300 {
		log.Println("⚠️  Request timestamp too old")
		return false
	}

	// Compute expected signature
	sigBasestring := fmt.Sprintf("%s.%s", timestamp, string(payload))
	mac := hmac.New(sha256.New, []byte(webhookSecret))
	mac.Write([]byte(sigBasestring))
	expectedSignature := "v1=" + hex.EncodeToString(mac.Sum(nil))

	// Compare signatures using constant-time comparison
	return subtle.ConstantTimeCompare([]byte(expectedSignature), []byte(signature)) == 1
}

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	signature := r.Header.Get("X-Webhook-Signature")
	timestamp := r.Header.Get("X-Webhook-Timestamp")
	webhookID := r.Header.Get("X-Webhook-Id")

	if signature == "" || timestamp == "" {
		http.Error(w, "Missing signature headers", http.StatusUnauthorized)
		return
	}

	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	fmt.Println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Println("📨 Webhook received")
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

	// Try to parse as verification request first
	var verifyReq VerificationRequest
	if err := json.Unmarshal(body, &verifyReq); err == nil {
		if verifyReq.Type == "webhook.verification" {
			fmt.Println("🔍 Webhook verification request (Stripe-style)")
			fmt.Printf("   Token: %s\n", verifyReq.VerificationToken)
			fmt.Println("✅ Responding with 200 OK\n")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("OK"))
			return
		}

		if verifyReq.Type == "url_verification" {
			fmt.Println("🔍 URL verification request (Slack-style)")
			fmt.Printf("   Challenge: %s\n", verifyReq.Challenge)
			fmt.Println("✅ Responding with challenge\n")
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(ChallengeResponse{Challenge: verifyReq.Challenge})
			return
		}
	}

	// Verify signature
	if !verifyWebhookSignature(body, signature, timestamp) {
		fmt.Println("❌ Invalid signature!")
		http.Error(w, "Invalid signature", http.StatusUnauthorized)
		return
	}

	fmt.Println("✅ Signature verified")

	// Parse event
	var event Event
	if err := json.Unmarshal(body, &event); err != nil {
		fmt.Printf("❌ Error parsing event: %v\n", err)
		http.Error(w, "Invalid payload", http.StatusBadRequest)
		return
	}

	fmt.Println("📋 Event details:")
	fmt.Printf("   ID: %s\n", event.ID)
	fmt.Printf("   Type: %s\n", event.Type)
	fmt.Printf("   Webhook ID: %s\n", webhookID)

	fmt.Println("\n📦 Event data:")
	dataJSON, _ := json.MarshalIndent(event.Data, "   ", "  ")
	fmt.Printf("   %s\n", string(dataJSON))

	// Process your webhook here
	// ...

	fmt.Println("\n✅ Webhook processed successfully\n")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

func homeHandler(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"status":  "ok",
		"message": "Go webhook receiver",
		"endpoints": map[string]string{
			"webhook": "POST /webhook",
		},
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func main() {
	webhookSecret = os.Getenv("WEBHOOK_SECRET")
	if webhookSecret == "" {
		webhookSecret = "whsec_your_secret_here"
	}

	r := mux.NewRouter()
	r.HandleFunc("/webhook", webhookHandler).Methods("POST")
	r.HandleFunc("/", homeHandler).Methods("GET")

	fmt.Println("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Println("🎯 Go Webhook Receiver")
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	fmt.Println("✅ Server running on http://localhost:8080")
	secretConfigured := webhookSecret != "whsec_your_secret_here"
	fmt.Printf("⚙️  Secret configured: %v\n", secretConfigured)
	fmt.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
	fmt.Println("Waiting for webhooks...\n")

	log.Fatal(http.ListenAndServe(":8080", r))
}
