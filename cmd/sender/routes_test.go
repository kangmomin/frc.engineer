package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

// Check the production registrations together: an isolated handler test cannot
// detect ServeMux conflicts that terminate the sender before its API starts.
func TestSenderRouteRegistration(t *testing.T) {
	source, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	ast.Inspect(source, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (selector.Sel.Name != "Handle" && selector.Sel.Name != "HandleFunc") {
			return true
		}
		receiver, ok := selector.X.(*ast.Ident)
		if !ok || receiver.Name != "mux" {
			return true
		}
		literal, ok := call.Args[0].(*ast.BasicLit)
		if !ok || literal.Kind != token.STRING {
			t.Fatal("sender route pattern must be a string literal")
		}
		pattern, err := strconv.Unquote(literal.Value)
		if err != nil {
			t.Fatal(err)
		}
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-Test-Route", pattern)
		})
		return true
	})
	for _, path := range []string{"/", "/api/status", "/api/sessions/recorded/trace"} {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		expected := "GET " + path
		if path == "/api/sessions/recorded/trace" {
			expected = "GET /api/sessions/{dir}/trace"
		}
		if w.Code != http.StatusOK || w.Header().Get("X-Test-Route") != expected {
			t.Errorf("GET %s: status=%d route=%q", path, w.Code, w.Header().Get("X-Test-Route"))
		}
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/sessions/recorded/trace", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST trace: status=%d, want 405", w.Code)
	}
}
