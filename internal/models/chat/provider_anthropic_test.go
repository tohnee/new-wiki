package chat

import (
	"net/http"
	"testing"

	"github.com/Tencent/WeKnora/internal/models/provider"
)

func TestAnthropicProvider_Name(t *testing.T) {
	p := anthropicProvider{}
	if p.Name() != provider.ProviderAnthropic {
		t.Errorf("Name() = %q, want %q", p.Name(), provider.ProviderAnthropic)
	}
}

func TestAnthropicProvider_Endpoint(t *testing.T) {
	p := anthropicProvider{}
	got := p.Endpoint("https://api.anthropic.com", "claude-3", true)
	want := "https://api.anthropic.com/v1/messages"
	if got != want {
		t.Errorf("Endpoint() = %q, want %q", got, want)
	}
}

func TestAnthropicProvider_ForceRawHTTP(t *testing.T) {
	p := anthropicProvider{}
	if !p.ForceRawHTTP() {
		t.Error("ForceRawHTTP() = false, want true")
	}
}

func TestAnthropicProvider_Auth(t *testing.T) {
	p := anthropicProvider{}
	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", nil)
	p.Auth(req, authCreds{APIKey: "test-key"}, nil)
	if got := req.Header.Get("x-api-key"); got != "test-key" {
		t.Errorf("x-api-key = %q, want %q", got, "test-key")
	}
	if got := req.Header.Get("anthropic-version"); got != "2023-06-01" {
		t.Errorf("anthropic-version = %q, want %q", got, "2023-06-01")
	}
}

func TestProviderRegistry_IncludesAnthropic(t *testing.T) {
	found := false
	for _, p := range providerRegistry {
		if p.Name() == provider.ProviderAnthropic {
			found = true
			break
		}
	}
	if !found {
		t.Error("providerRegistry does not include anthropicProvider")
	}
}

func TestResolveProvider_Anthropic(t *testing.T) {
	p := resolveProvider(provider.ProviderAnthropic, "claude-3-opus")
	if p.Name() != provider.ProviderAnthropic {
		t.Errorf("resolveProvider(Anthropic) = %q, want Anthropic", p.Name())
	}
}
