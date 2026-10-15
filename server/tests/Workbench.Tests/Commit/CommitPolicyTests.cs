using Workbench.Core.Commit;
using Workbench.Core.Contracts;

namespace Workbench.Tests.Commit;

public class SegmentCommitPolicyTests
{
    private static SttResult I(string t) => new(t, IsFinal: false);
    private static SttResult F(string t) => new(t, IsFinal: true);

    private static List<string> Run(ICommitPolicy p, params SttResult[] results)
    {
        var accepted = results.SelectMany(p.Accept).ToList(); // before Flush: Concat would call Flush eagerly
        return accepted.Concat(p.Flush()).Select(s => s.Text).ToList();
    }

    [Fact]
    public void Commits_each_final_segment_during_speech_and_ignores_interim_revisions()
    {
        var p = new SegmentCommitPolicy();
        Assert.Empty(p.Accept(I("My son")));
        Assert.Empty(p.Accept(I("My sun has")));          // revision: nothing committed yet
        var seg = Assert.Single(p.Accept(F("My son has had a fever.")));
        Assert.Equal((0, "My son has had a fever."), (seg.Index, seg.Text));
        var next = Assert.Single(p.Accept(F("Since last night.")));
        Assert.Equal(1, next.Index);
    }

    [Fact]
    public void Empty_finals_commit_nothing()
    {
        Assert.Empty(Run(new SegmentCommitPolicy(), F(""), F("   "), I(""), F("")));
    }

    [Fact]
    public void A_finalize_response_repeating_the_last_final_is_committed_once()
    {
        Assert.Equal(["Tengo una cita."], Run(new SegmentCommitPolicy(), F("Tengo una cita."), new SttResult("Tengo  una cita.", true, FromFinalize: true)));
    }

    [Fact]
    public void A_genuinely_repeated_utterance_is_committed_twice()
    {
        Assert.Equal(["No.", "No."], Run(new SegmentCommitPolicy(), F("No."), F("No.")));
    }

    [Fact]
    public void Flush_commits_a_trailing_interim_that_never_finalized()
    {
        Assert.Equal(["Hello.", "and then"], Run(new SegmentCommitPolicy(), F("Hello."), I("and"), I("and then")));
    }

    [Fact]
    public void Run_on_speech_without_finals_commits_only_at_the_end()
    {
        var p = new SegmentCommitPolicy();
        var during = new[] { "the pain", "the pain started after", "the pain started after lunch and it is getting" }
            .SelectMany(t => p.Accept(I(t))).ToList();
        Assert.Empty(during);
        Assert.Equal("the pain started after lunch and it is getting worse",
            Assert.Single(p.Accept(F("the pain started after lunch and it is getting worse"))).Text);
    }
}

public class ClauseCommitPolicyTests
{
    private static SttResult I(string t) => new(t, IsFinal: false);
    private static SttResult F(string t) => new(t, IsFinal: true);

    private static List<string> Run(ICommitPolicy p, params SttResult[] results)
    {
        var accepted = results.SelectMany(p.Accept).ToList(); // before Flush: Concat would call Flush eagerly
        return accepted.Concat(p.Flush()).Select(s => s.Text).ToList();
    }

    [Fact]
    public void Commits_a_clause_once_its_boundary_is_stable_then_the_remainder_on_final()
    {
        var p = new ClauseCommitPolicy();
        Assert.Empty(p.Accept(I("The pain started after lunch,")));
        // Second partial confirms the comma clause: commit it before the segment finalizes.
        var first = Assert.Single(p.Accept(I("The pain started after lunch, and it")));
        Assert.Equal("The pain started after lunch,", first.Text);
        Assert.Empty(p.Accept(I("The pain started after lunch, and it is getting")));
        var rest = Assert.Single(p.Accept(F("The pain started after lunch, and it is getting worse.")));
        Assert.Equal("and it is getting worse.", rest.Text);
        Assert.Equal(1, rest.Index);
    }

    [Fact]
    public void Splits_before_a_stable_conjunction_without_punctuation()
    {
        var committed = Run(new ClauseCommitPolicy(),
            I("my son has had a fever"),
            I("my son has had a fever since last night and"),
            I("my son has had a fever since last night and it"),
            F("my son has had a fever since last night and it is getting worse"));
        Assert.Equal(["my son has had a fever since last night", "and it is getting worse"], committed);
    }

    [Fact]
    public void Does_not_commit_unstable_words_that_are_later_revised()
    {
        var p = new ClauseCommitPolicy();
        Assert.Empty(p.Accept(I("I need to move,")));
        // The comma clause was revised before it became stable: nothing committed.
        Assert.Empty(p.Accept(I("I need to move my appointment")));
        Assert.Equal("I need to move my appointment to Friday morning.",
            Assert.Single(p.Accept(F("I need to move my appointment to Friday morning."))).Text);
    }

    [Fact]
    public void Never_resends_committed_text_and_has_no_duplicate_commits()
    {
        var committed = Run(new ClauseCommitPolicy(),
            I("Tengo una cita a las tres,"),
            I("Tengo una cita a las tres, con"),
            I("Tengo una cita a las tres, con la"),
            I("Tengo una cita a las tres, con la doctora."),
            I("Tengo una cita a las tres, con la doctora."),
            F("Tengo una cita a las tres, con la doctora."));
        Assert.Equal(["Tengo una cita a las tres,", "con la doctora."], committed);
        // Joined, the commits reproduce the utterance exactly once.
        Assert.Equal("Tengo una cita a las tres, con la doctora.", string.Join(' ', committed));
    }

    [Fact]
    public void Short_fragments_wait_for_more_words()
    {
        var p = new ClauseCommitPolicy();
        p.Accept(I("So, and"));
        Assert.Empty(p.Accept(I("So, and then he")));
    }

    [Theory]
    // EN/ES reordering: adjective-noun order flips between the languages ("red rash" / "sarpullido rojo",
    // "the blue pills" / "las pastillas azules"). The policy must never cut inside a noun phrase, only at
    // clause boundaries, so the translator always sees whole phrases it can reorder.
    [InlineData("He has a red rash on his arm and it itches", "He has a red rash on his arm", "and it itches")]
    [InlineData("Tome las pastillas azules y luego descanse", "Tome las pastillas azules", "y luego descanse")]
    [InlineData("No entiendo las instrucciones de la receta pero mi esposa sí", "No entiendo las instrucciones de la receta", "pero mi esposa sí")]
    public void Reordering_examples_cut_only_at_clause_boundaries(string utterance, string firstClause, string rest)
    {
        var words = utterance.Split(' ');
        var p = new ClauseCommitPolicy();
        var commits = new List<string>();
        // Stream growing partials word by word, each repeated once (so each word becomes stable).
        for (var n = 1; n <= words.Length; n++)
        {
            var partial = string.Join(' ', words[..n]);
            commits.AddRange(p.Accept(I(partial)).Select(s => s.Text));
            commits.AddRange(p.Accept(I(partial)).Select(s => s.Text));
        }
        commits.AddRange(p.Accept(F(utterance)).Select(s => s.Text));
        Assert.Equal([firstClause, rest], commits);
    }

    [Fact]
    public void A_revision_of_committed_words_does_not_lose_or_repeat_words()
    {
        var p = new ClauseCommitPolicy();
        p.Accept(I("I went to the store,"));
        Assert.Equal("I went to the store,", Assert.Single(p.Accept(I("I went to the store, and"))).Text);
        // STT revises "went to the" -> "want to" (one word fewer) in the final.
        Assert.Equal("and bought milk.", Assert.Single(p.Accept(F("I want to store, and bought milk."))).Text);
    }

    [Fact]
    public void Empty_final_and_empty_flush_commit_nothing()
    {
        Assert.Empty(Run(new ClauseCommitPolicy(), F(""), I(""), F(" ")));
    }

    [Fact]
    public void Flush_commits_uncommitted_interim_words_when_no_final_arrives()
    {
        Assert.Equal(["It hurts here,", "near the knee"],
            Run(new ClauseCommitPolicy(), I("It hurts here,"), I("It hurts here, near"), I("It hurts here, near the knee")));
    }

    [Fact]
    public void Factory_selects_by_name_and_defaults_to_segment()
    {
        Assert.IsType<ClauseCommitPolicy>(CommitPolicyFactory.Create("clause"));
        Assert.IsType<SegmentCommitPolicy>(CommitPolicyFactory.Create("segment"));
        Assert.IsType<SegmentCommitPolicy>(CommitPolicyFactory.Create("anything"));
    }
}
