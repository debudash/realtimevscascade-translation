using Workbench.Core.Contracts;

namespace Workbench.Core.Commit;

/// <summary>
/// `segment` (default): commit each STT-finalized segment, as it is finalized during speech.
/// Pure: no I/O, no clocks. One instance per turn.
/// </summary>
public sealed class SegmentCommitPolicy : ICommitPolicy
{
    private int _next;
    private string? _lastCommitted;
    private string _pendingInterim = "";

    public string Name => "segment";

    public IReadOnlyList<Segment> Accept(SttResult result)
    {
        var text = Normalize(result.Text);
        if (!result.IsFinal)
        {
            _pendingInterim = text;
            return [];
        }
        _pendingInterim = "";
        // Empty finals and duplicate finals (e.g. a repeated finalize response) commit nothing.
        if (text.Length == 0 || text == _lastCommitted) return [];
        _lastCommitted = text;
        return [new Segment(_next++, text)];
    }

    /// <summary>If the turn ended on an interim that never finalized (STT timeout), commit it.</summary>
    public IReadOnlyList<Segment> Flush()
    {
        var text = _pendingInterim;
        _pendingInterim = "";
        if (text.Length == 0 || text == _lastCommitted) return [];
        _lastCommitted = text;
        return [new Segment(_next++, text)];
    }

    internal static string Normalize(string s) => string.Join(' ', s.Split(' ', StringSplitOptions.RemoveEmptyEntries));
}

/// <summary>
/// `clause`: commit on clause boundaries within stable partials, before the segment finalizes.
/// - Stable = the word prefix unchanged between two consecutive interim results.
/// - Boundary = after clause punctuation (, ; : . ? !) or before a conjunction.
/// - A clause needs at least <see cref="MinClauseWords"/> words unless it ends in . ? !
/// - Committed words are never re-sent; on the final result only the remainder is committed.
///   If STT later revises words that were already committed, the revision is not re-translated
///   (the price of committing early; reported as a limitation).
/// </summary>
public sealed class ClauseCommitPolicy : ICommitPolicy
{
    public const int MinClauseWords = 3;

    private static readonly HashSet<string> Conjunctions = new(StringComparer.OrdinalIgnoreCase)
    {
        // English
        "and", "but", "because", "so", "or", "then", "although", "though", "while", "when", "if", "unless",
        // Spanish
        "y", "e", "pero", "porque", "entonces", "o", "u", "aunque", "mientras", "cuando", "si", "pues",
        // French (language-pair onboarding)
        "et", "mais", "parce", "donc", "ou", "alors", "quand", "lorsque",
    };

    private int _next;
    private string[] _prevInterim = [];
    private int _committedWords; // words of the current (unfinalized) segment already committed

    public string Name => "clause";

    public IReadOnlyList<Segment> Accept(SttResult result)
    {
        var words = Words(result.Text);

        if (result.IsFinal)
        {
            _prevInterim = [];
            var rest = words.Skip(_committedWords).ToArray();
            _committedWords = 0;
            return rest.Length == 0 ? [] : [new Segment(_next++, string.Join(' ', rest))];
        }

        var stable = CommonPrefix(_prevInterim, words);
        _prevInterim = words;
        var cut = LastBoundary(words, stable, _committedWords);
        if (cut <= _committedWords) return [];

        var clause = words[_committedWords..cut];
        _committedWords = cut;
        return [new Segment(_next++, string.Join(' ', clause))];
    }

    /// <summary>Commits whatever interim text was left uncommitted when the turn ended without a final.</summary>
    public IReadOnlyList<Segment> Flush()
    {
        var rest = _prevInterim.Skip(_committedWords).ToArray();
        _prevInterim = [];
        _committedWords = 0;
        return rest.Length == 0 ? [] : [new Segment(_next++, string.Join(' ', rest))];
    }

    private static string[] Words(string text) => text.Split(' ', StringSplitOptions.RemoveEmptyEntries);

    private static int CommonPrefix(string[] a, string[] b)
    {
        var n = 0;
        while (n < a.Length && n < b.Length && a[n] == b[n]) n++;
        return n;
    }

    /// <summary>
    /// The largest index i in (from, stable] such that words[from..i] is a complete clause.
    /// Returns from when there is none.
    /// </summary>
    private static int LastBoundary(string[] words, int stable, int from)
    {
        var best = from;
        for (var i = from + 1; i <= stable; i++)
        {
            var len = i - from;
            var last = words[i - 1];
            var strong = last.EndsWith('.') || last.EndsWith('?') || last.EndsWith('!');
            var weak = last.EndsWith(',') || last.EndsWith(';') || last.EndsWith(':');
            // Before a conjunction: the conjunction must itself be stable (i < stable).
            var beforeConjunction = i < stable && Conjunctions.Contains(words[i].TrimEnd(',', '.'));
            if (strong || ((weak || beforeConjunction) && len >= MinClauseWords)) best = i;
        }
        return best;
    }
}

public static class CommitPolicyFactory
{
    public static ICommitPolicy Create(string name) => name switch
    {
        "clause" => new ClauseCommitPolicy(),
        _ => new SegmentCommitPolicy(),
    };
}
