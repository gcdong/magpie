package gui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

// What a model takes is its provider's own, not its group's: the reasoning
// levels agents are offered for it and whether it sees images are edited on
// the chips its row carries in the Routing page's group editor, which write
// through provider.SetModelEfforts, SetModelReasonless and SetModelImage.
// So /api/groups says, of each member, the levels its model has of its own
// (Own, before the ones the user kept), whether the user said it takes no
// reasoning ask, and whether the user answered for its images — the three
// things the editor needs to offer them.
func TestGroupMemberCarriesWhatItsProviderCanChange(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", os.Getenv("HOME"))
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	yes, no := true, false
	if err := provider.Save(provider.Provider{ID: "p", Name: "P", Key: "k", Chat: "http://127.0.0.1:1/v1",
		Models: []string{"six", "none", "eye"}}); err != nil {
		t.Fatal(err)
	}
	if err := catalog.SaveLive("p", "http://127.0.0.1:1/v1", []catalog.Model{
		{ID: "six", Context: 200000, Efforts: []string{"none", "low", "medium", "high", "xhigh", "max"}},
		{ID: "none", Context: 128000, ImageInput: &no},
		{ID: "eye", Context: 64000, Images: true, ImageInput: &yes},
	}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SaveGroup(provider.Group{ID: "g", Name: "G", Members: []string{"p/six", "p/none", "p/eye"}}); err != nil {
		t.Fatal(err)
	}
	// the user keeps low and high of the six, says none takes no reasoning
	// ask, and answers for eye's images over its list
	if err := provider.SetModelEfforts("p/six", []string{"low", "high"}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SetModelReasonless("p/none", true); err != nil {
		t.Fatal(err)
	}
	if err := provider.SetModelImage("p/eye", &no); err != nil {
		t.Fatal(err)
	}
	byID := map[string]memberJSON{}
	for _, g := range groupsState().Groups {
		if g.ID == "g" {
			for _, m := range g.Info {
				byID[m.ID] = m
			}
		}
	}
	six := byID["p/six"]
	if !slices.Equal(six.Efforts, []string{"low", "high"}) {
		t.Errorf("six offers %v, want the levels kept", six.Efforts)
	}
	if !slices.Equal(six.Own, []string{"none", "low", "medium", "high", "xhigh", "max"}) {
		t.Errorf("six has of its own %v, want every level its list gives", six.Own)
	}
	none := byID["p/none"]
	if !none.Reasonless || len(none.Efforts) != 0 {
		t.Errorf("none: reasonless %v offers %v, want true and none", none.Reasonless, none.Efforts)
	}
	// the user's no is what a chip needs: images false, and not called
	// unknown — no `imageSet` on a member, which is the Gateway page's name
	// for the same thing (#885)
	eye := byID["p/eye"]
	if eye.Images || eye.ImagesUnknown {
		t.Errorf("eye: images %v imagesUnknown %v, want the user's no, known", eye.Images, eye.ImagesUnknown)
	}
	// and `imageSet` itself is never on the wire for a member, though the
	// user answered for eye: that key is the Gateway page's (#885, where
	// modelInfo is shared by both pages). Held on the JSON, since a false
	// one would be left out and prove nothing.
	b, err := json.Marshal(groupsState())
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Groups []struct {
			Info []map[string]any `json:"memberInfo"`
		} `json:"groups"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	for _, g := range doc.Groups {
		for _, m := range g.Info {
			if _, ok := m["imageSet"]; ok {
				t.Errorf("member %v carries imageSet; a member answers with images and imagesUnknown (#885)", m["id"])
			}
		}
	}
}

// The editor's two chips write through /api/provider/{efforts,reasonless,images},
// the same calls the provider's own Names, prices & levels makes, and a save
// that leaves the group alone changes no group.
func TestGroupMemberChipsWriteTheModel(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", os.Getenv("HOME"))
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	if err := provider.Save(provider.Provider{ID: "p", Name: "P", Key: "k", Chat: "http://127.0.0.1:1/v1", Models: []string{"m"}}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SaveGroup(provider.Group{ID: "g", Name: "G", Members: []string{"p/m"}}); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	providerRoutes(mux, nil)
	post := func(path, body string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("POST", path, strings.NewReader(body)))
		return w
	}
	if w := post("/api/provider/efforts", `{"id":"p","model":"m","efforts":["low","high"]}`); w.Code != 200 {
		t.Fatalf("efforts: %d %s", w.Code, w.Body)
	}
	if w := post("/api/provider/reasonless", `{"id":"p","model":"m","reasonless":true}`); w.Code != 200 {
		t.Fatalf("reasonless: %d %s", w.Code, w.Body)
	}
	if w := post("/api/provider/reasonless", `{"id":"p","model":"m"}`); w.Code != 400 {
		t.Fatalf("reasonless with no answer: %d %s, want 400", w.Code, w.Body)
	}
	if w := post("/api/provider/reasonless", `{"id":"p","model":"m","reasonless":false}`); w.Code != 200 {
		t.Fatalf("reasonless off: %d %s", w.Code, w.Body)
	}
	if w := post("/api/provider/images", `{"id":"p","model":"m","images":true}`); w.Code != 200 {
		t.Fatalf("images: %d %s", w.Code, w.Body)
	}
	s := settings.Load()
	if s.ModelReasonless["p/m"] {
		t.Error("reasonless kept though the answer came back")
	}
	if !s.ModelImages["p/m"] {
		t.Error("images not kept")
	}
	// the group is as it was: a chip changes the model, never the group
	var g *provider.Group
	for _, x := range provider.Groups() {
		if x.ID == "g" {
			y := x
			g = &y
		}
	}
	if g == nil || !slices.Equal(g.Members, []string{"p/m"}) {
		t.Fatalf("the group is %+v", g)
	}
}
